class_name Scraper
extends RefCounted
## A metadata provider (ScreenScraper, TheGamesDB, IGDB...) that looks up games
## and platforms and returns their metadata and media URLs in one common shape.
##
## To add a provider, subclass this, override the lookups, give it TYPE,
## DISPLAY_NAME and FIELDS constants (see ScreenScraper), and list it in
## Scrapers.types(). The settings screen builds its form from FIELDS: each field
## is { key, label, kind ("text", "password" or "choice"), default, options
## ([[value, label], ...] for choices), help }.
##
## Lookups block on the network and run on a worker thread (see ScrapeJob), one
## at a time, so a provider may keep state between calls. Call _wait_turn()
## before each request to stay within the provider's rate limit.

## Media kinds a result can have. Card art is picked from these by settings.
const GAME_MEDIA: Array = [
	["boxart", "Box art"],
	["screenshot", "Screenshot"],
	["title", "Title screen"],
	["logo", "Logo"],
	["fanart", "Fan art"],
]
const PLATFORM_MEDIA: Array = [
	["logo", "Logo"],
	["photo", "Photo of the console"],
]

## Settings every provider has, appended to its own FIELDS by the settings screen.
const COMMON_FIELDS: Array = [
	{ "key": "game_art", "label": "Game art", "kind": "choice", "default": "boxart",
		"options": GAME_MEDIA },
	{ "key": "platform_art", "label": "Platform art", "kind": "choice", "default": "logo",
		"options": PLATFORM_MEDIA },
]

## The settings this scraper was created from: `type` plus FIELDS and COMMON_FIELDS.
var config: Dictionary
## Seconds between requests. Providers may change it from what the service reports.
var min_interval := 1.0

var _next_request_msec := 0


## What a lookup found.
class Result:
	enum Status {
		FOUND,
		NOT_FOUND,
		## This item failed (bad data, network hiccup). Carry on with the next.
		ERROR,
		## The provider can't be used now (login, quota, service closed). Stop.
		STOP,
	}

	var status := Status.NOT_FOUND
	## Why it failed, for the log and the settings screen.
	var message := ""
	## Any of: name, description, year (int), developer, publisher, genre,
	## players, rating (0..1 float). Missing keys mean unknown.
	var metadata := {}
	## Media kind (see GAME_MEDIA / PLATFORM_MEDIA) -> URL.
	var media := {}

	static func make(result_status: Status, result_message := "") -> Result:
		var result := Result.new()
		result.status = result_status
		result.message = result_message
		return result


func _init(scraper_config := {}) -> void:
	config = scraper_config


## Whether this provider knows the platform (by its `key`, e.g. "nes"). Games on
## other platforms are skipped, so generated or custom platforms cost no requests.
func supports_platform(_platform: Dictionary) -> bool:
	return false


## Looks up a game. `game` has name, file (ROM file name, may be empty), and
## optionally crc, md5, sha1, size. `platform` has key and name.
func scrape_game(_game: Dictionary, _platform: Dictionary) -> Result:
	return Result.make(Result.Status.STOP, "Not implemented")


## Looks up a platform's own metadata and media.
func scrape_platform(_platform: Dictionary) -> Result:
	return Result.make(Result.Status.NOT_FOUND)


## Downloads a media URL from a result. Empty on failure.
func download(url: String) -> PackedByteArray:
	_wait_turn()
	var response := HttpFetch.fetch(url, 60.0)
	return response.body if response.status == 200 else PackedByteArray()


## Checks the settings by contacting the provider. Blocks; call it off the
## main thread. Returns { "ok": bool, "message": String }.
func check() -> Dictionary:
	return { "ok": false, "message": "Not implemented" }


## Sleeps until min_interval has passed since the previous request.
func _wait_turn() -> void:
	var wait := _next_request_msec - Time.get_ticks_msec()
	if wait > 0:
		OS.delay_msec(wait)
	_next_request_msec = Time.get_ticks_msec() + int(min_interval * 1000)
