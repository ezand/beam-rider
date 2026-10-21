class_name ScrapeJob
extends RefCounted
## One pass of a Scraper over the library: each supported platform's art, then
## each of its games. Metadata goes into the database, art into the metadata
## sources (if they can be written), named the way the cards look it up.
## Existing art is never replaced, so hand-picked art stays and isn't
## downloaded again.
##
## run() blocks for as long as the scraper takes (seconds per game). Use
## LibraryScraper to run it in the background, or call it from a tool script.

## Stop after this many failed lookups in a row: the service is probably down.
const MAX_ERRORS_IN_A_ROW := 5

## Called with an event Dictionary on the thread running the job:
## { type: "progress", done, total, text }
## { type: "art", scope: "platform" or "game", key }  (art was saved)
## { type: "finished", found, not_found, failed, stopped, message }
var on_event: Callable = func(_event: Dictionary) -> void: pass

var database_path: String
var scraper: Scraper
var platform_art: MetadataSource
var game_art: MetadataSource
## Media kinds to save as card art, from settings (see Scraper.GAME_MEDIA).
var game_art_kind := "boxart"
var platform_art_kind := "logo"
## Only games never scraped before. False scrapes every game again.
var only_unscraped := true

var _cancelled := false


func _init(db_path: String, job_scraper: Scraper, platform_source: MetadataSource,
		game_source: MetadataSource) -> void:
	database_path = db_path
	scraper = job_scraper
	platform_art = platform_source
	game_art = game_source
	game_art_kind = str(scraper.config.get("game_art", game_art_kind))
	platform_art_kind = str(scraper.config.get("platform_art", platform_art_kind))


## Asks a running job to stop after the current item. Safe from any thread.
func cancel() -> void:
	_cancelled = true


func run() -> Dictionary:
	var summary := { "type": "finished", "found": 0, "not_found": 0, "failed": 0,
			"stopped": false, "message": "" }
	var library := GameLibrary.new()
	if not library.open(database_path):
		summary.stopped = true
		summary.message = "Could not open the library."
		on_event.call(summary)
		return summary

	# Work list: [platform, game] pairs, with an empty game for the platform itself.
	var work := []
	for platform: Dictionary in library.get_platforms():
		if not scraper.supports_platform(platform):
			continue
		if not _has_art(platform_art, MetadataSource.file_name(platform.name)):
			work.append([platform, {}])
		for game: Dictionary in library.get_games_to_scrape(platform.id, only_unscraped):
			work.append([platform, game])

	var errors_in_a_row := 0
	for i in work.size():
		if _cancelled:
			summary.stopped = true
			summary.message = "Stopped."
			break
		var platform: Dictionary = work[i][0]
		var game: Dictionary = work[i][1]
		on_event.call({ "type": "progress", "done": i, "total": work.size(),
				"text": "%s › %s" % [platform.name, game.name] if game else platform.name })
		var result := scraper.scrape_game(game, platform) if game else scraper.scrape_platform(platform)
		match result.status:
			Scraper.Result.Status.FOUND:
				errors_in_a_row = 0
				summary.found += 1
				if game:
					library.save_scrape(game.id, "found", result.metadata)
					_save_art(result, game_art, game_art_kind, Scraper.GAME_MEDIA, "game",
							"%s/%s" % [MetadataSource.file_name(platform.name),
							MetadataSource.file_name(game.name)])
				else:
					_save_art(result, platform_art, platform_art_kind, Scraper.PLATFORM_MEDIA,
							"platform", MetadataSource.file_name(platform.name))
			Scraper.Result.Status.NOT_FOUND:
				errors_in_a_row = 0
				summary.not_found += 1
				if game:
					library.save_scrape(game.id, "not_found")
			Scraper.Result.Status.ERROR:
				summary.failed += 1
				errors_in_a_row += 1
				push_warning("Scraping %s failed: %s" % [game.get("name", platform.name), result.message])
				if errors_in_a_row >= MAX_ERRORS_IN_A_ROW:
					summary.stopped = true
					summary.message = result.message
					break
			Scraper.Result.Status.STOP:
				summary.stopped = true
				summary.message = result.message
				break
	library.close()
	if work.is_empty():
		summary.message = "Nothing to scrape."
	on_event.call(summary)
	return summary


## Downloads the preferred media kind (else the next available, in `kinds`
## order) and saves it at `key` + extension, unless art is already there.
func _save_art(result: Scraper.Result, source: MetadataSource, preferred: String,
		kinds: Array, scope: String, key: String) -> void:
	if source == null or not source.can_write() or _has_art(source, key):
		return
	var order := [preferred]
	for kind: Array in kinds:
		if kind[0] != preferred:
			order.append(kind[0])
	for kind: String in order:
		if not result.media.has(kind):
			continue
		var data := scraper.download(result.media[kind])
		var extension := _image_extension(data)
		if extension.is_empty():
			continue
		if source.write_file("%s.%s" % [key, extension], data):
			on_event.call({ "type": "art", "scope": scope, "key": key })
		return


func _has_art(source: MetadataSource, key: String) -> bool:
	return source != null and not source.read_first(key, ArtLoader.EXTENSIONS).is_empty()


## "png", "jpg" or "webp" from the file's first bytes, or "" if not an image.
static func _image_extension(data: PackedByteArray) -> String:
	if data.size() < 12:
		return ""
	if data[0] == 0x89 and data[1] == 0x50 and data[2] == 0x4E and data[3] == 0x47:
		return "png"
	if data[0] == 0xFF and data[1] == 0xD8:
		return "jpg"
	if data.slice(0, 4).get_string_from_ascii() == "RIFF" \
			and data.slice(8, 12).get_string_from_ascii() == "WEBP":
		return "webp"
	return ""
