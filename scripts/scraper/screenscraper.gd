class_name ScreenScraper
extends Scraper
## ScreenScraper.fr through its API v2 (https://www.screenscraper.fr/webapi2.php).
##
## Games are matched by ROM file name (plus checksums and size when known),
## falling back to a name search. API access needs developer credentials for
## the calling software; a user account is optional but raises the daily quota
## and the request rate.

const TYPE := "screenscraper"
const DISPLAY_NAME := "ScreenScraper"
const FIELDS: Array = [
	{ "key": "username", "label": "Username", "kind": "text", "default": "",
		"help": "Your screenscraper.fr account. Optional, but gives a higher daily quota." },
	{ "key": "password", "label": "Password", "kind": "password", "default": "" },
	{ "key": "dev_id", "label": "Developer ID", "kind": "text", "default": "",
		"help": "API access for this app, requested on the ScreenScraper forum." },
	{ "key": "dev_password", "label": "Developer password", "kind": "password", "default": "" },
	{ "key": "region", "label": "Region", "kind": "choice", "default": "us",
		"options": [["us", "USA"], ["eu", "Europe"], ["jp", "Japan"], ["wor", "World"]] },
	{ "key": "language", "label": "Language", "kind": "choice", "default": "en",
		"options": [["en", "English"], ["fr", "French"], ["de", "German"], ["es", "Spanish"],
			["it", "Italian"], ["pt", "Portuguese"]] },
]

const API_URL := "https://api.screenscraper.fr/api2/"
const SOFTWARE_NAME := "BeamRider"
## BeamRider's own developer credentials, once it has them. Settings override.
const DEV_ID := ""
const DEV_PASSWORD := ""

## Platform keys (RetroPie folder names) -> ScreenScraper system ids, from
## Skyscraper's platforms_idmap.csv.
const SYSTEM_IDS := {
	"megadrive": 1, "genesis": 1, "mastersystem": 2, "nes": 3, "snes": 4, "gb": 9,
	"gbc": 10, "virtualboy": 11, "gba": 12, "gc": 13, "n64": 14, "nds": 15, "wii": 16,
	"segacd": 20, "gamegear": 21, "saturn": 22, "dreamcast": 23, "ngp": 25,
	"atari2600": 26, "3do": 29, "pcengine": 31, "atari5200": 40, "atari7800": 41,
	"wonderswan": 45, "coleco": 48, "psx": 57, "ps2": 58, "psp": 61, "amiga": 64,
	"amstradcpc": 65, "c64": 66, "pcfx": 72, "arcade": 75, "mame": 75, "fba": 75,
	"zxspectrum": 76, "vectrex": 102, "fds": 106, "sg-1000": 109, "msx": 113,
	"intellivision": 115, "neogeo": 142,
}
const ARCADE_SYSTEMS := [75, 142]

## ScreenScraper asks scrapers to stay at or below this rate.
const MIN_INTERVAL := 1.2
const RETRIES := 3

## Media kind -> ScreenScraper media types, best first.
const GAME_MEDIA_TYPES := {
	"boxart": ["box-2D"],
	"screenshot": ["ss"],
	"title": ["sstitle"],
	"logo": ["wheel-hd", "wheel"],
	"fanart": ["fanart"],
}
const PLATFORM_MEDIA_TYPES := {
	"logo": ["wheel", "wheel-carbon", "wheel-steel"],
	"photo": ["photo"],
}

## HTTP status -> why scraping has to stop.
const STOP_MESSAGES := {
	401: "ScreenScraper is only open to registered members right now. Add your username and password, or try again later.",
	403: "ScreenScraper rejected the developer ID or password.",
	423: "ScreenScraper's API is closed right now. Try again later.",
	426: "ScreenScraper no longer accepts this version of BeamRider.",
	430: "Your ScreenScraper quota for today is used up. Try again tomorrow.",
	431: "ScreenScraper has seen too many unrecognized games from you today. Try again tomorrow.",
}

## systemesListe.php result, fetched once.
var _systems: Array = []


func _init(scraper_config := {}) -> void:
	super(scraper_config)
	min_interval = MIN_INTERVAL


func supports_platform(platform: Dictionary) -> bool:
	return SYSTEM_IDS.has(str(platform.get("key", "")))


func scrape_game(game: Dictionary, platform: Dictionary) -> Result:
	if _dev_id().is_empty():
		return Result.make(Result.Status.STOP, "ScreenScraper needs a developer ID.")
	var system_id: int = SYSTEM_IDS.get(str(platform.get("key", "")), 0)
	var file := str(game.get("file", ""))
	if not file.is_empty():
		var reply := _call("jeuInfos.php", {
			"systemeid": system_id, "romtype": "rom", "romnom": file,
			"romtaille": game.get("size", ""), "crc": game.get("crc", ""),
			"md5": game.get("md5", ""), "sha1": game.get("sha1", ""),
		})
		if reply.has("response") and reply.response.get("jeu") is Dictionary:
			return _game_result(reply.response.jeu, system_id)
		if reply.has("result") and reply.result.status != Result.Status.NOT_FOUND:
			return reply.result

	var search := _call("jeuRecherche.php", { "systemeid": system_id, "recherche": game.get("name", "") })
	if search.has("result"):
		return search.result
	for jeu: Variant in search.response.get("jeux", []):
		if jeu is Dictionary and jeu.has("id"):
			return _game_result(jeu, system_id)
	return Result.make(Result.Status.NOT_FOUND)


func scrape_platform(platform: Dictionary) -> Result:
	if _dev_id().is_empty():
		return Result.make(Result.Status.STOP, "ScreenScraper needs a developer ID.")
	if _systems.is_empty():
		var reply := _call("systemesListe.php", {})
		if reply.has("result"):
			return reply.result
		_systems = reply.response.get("systemes", [])
	var system_id: int = SYSTEM_IDS.get(str(platform.get("key", "")), 0)
	for system: Variant in _systems:
		if system is Dictionary and int(system.get("id", 0)) == system_id:
			var result := Result.make(Result.Status.FOUND)
			var names: Variant = system.get("noms", {})
			if names is Dictionary:
				for region in _regions():
					if names.has("nom_" + region):
						result.metadata.name = names["nom_" + region]
						break
			result.metadata.publisher = str(system.get("compagnie", ""))
			var start := str(system.get("datedebut", ""))
			if start.left(4).is_valid_int():
				result.metadata.year = int(start.left(4))
			for kind in PLATFORM_MEDIA_TYPES:
				var url := _media_url(system.get("medias", []), PLATFORM_MEDIA_TYPES[kind])
				if not url.is_empty():
					result.media[kind] = url
			return result
	return Result.make(Result.Status.NOT_FOUND)


func check() -> Dictionary:
	if _dev_id().is_empty():
		return { "ok": false, "message": "Needs a developer ID and password. Request them on the ScreenScraper forum." }
	var has_user := not str(config.get("username", "")).is_empty()
	var reply := _call("ssuserInfos.php" if has_user else "ssinfraInfos.php", {})
	if reply.has("result"):
		var result: Result = reply.result
		var message := result.message
		if result.status == Result.Status.NOT_FOUND:
			message = "Unknown username or wrong password."
		return { "ok": false, "message": message }
	var user: Variant = reply.response.get("ssuser")
	if user is Dictionary:
		return { "ok": true, "message": "Connected as %s. %s of %s requests used today." % [
				user.get("id", config.get("username")), user.get("requeststoday", "?"),
				user.get("maxrequestsperday", "?")] }
	return { "ok": true, "message": "Connected without an account. Add one for a higher quota." }


## Makes one API request. Returns { "response": Dictionary } on success, or
## { "result": Result } saying why not.
func _call(endpoint: String, params: Dictionary) -> Dictionary:
	var all_params := {
		"devid": _dev_id(), "devpassword": _dev_password(), "softname": SOFTWARE_NAME,
		"output": "json", "ssid": config.get("username", ""),
		"sspassword": config.get("password", ""),
	}
	all_params.merge(params)
	var url := API_URL + endpoint + "?" + HttpFetch.query(all_params)
	var failure := Result.make(Result.Status.ERROR, "No response from ScreenScraper")
	for attempt in RETRIES:
		_wait_turn()
		var response := HttpFetch.fetch(url, 60.0)
		var text: String = response.body.get_string_from_utf8()
		match response.status:
			200:
				# The API sometimes leaves a trailing comma that JSON parsers reject.
				var data: Variant = JSON.parse_string(text.replace("],\n\t\t}", "]\n\t\t}"))
				if data is Dictionary and data.get("response") is Dictionary:
					_update_limits(data.response)
					return { "response": data.response }
				return { "result": Result.make(Result.Status.ERROR,
						"Unexpected reply from ScreenScraper: %s" % text.left(120).strip_edges()) }
			404:
				return { "result": Result.make(Result.Status.NOT_FOUND) }
			429, 0:
				# Too many threads, or a network error: back off and retry.
				failure.message = response.error if response.status == 0 \
						else "ScreenScraper is busy"
				OS.delay_msec(2000 * (attempt + 1))
			_:
				if STOP_MESSAGES.has(response.status):
					return { "result": Result.make(Result.Status.STOP, STOP_MESSAGES[response.status]) }
				return { "result": Result.make(Result.Status.ERROR, "ScreenScraper error %d: %s" % [
						response.status, text.left(120).strip_edges()]) }
	return { "result": failure }


## Slows down to the per-minute limit ScreenScraper reports for this user.
func _update_limits(response: Dictionary) -> void:
	var user: Variant = response.get("ssuser")
	if not user is Dictionary:
		return
	var per_minute := int(user.get("maxrequestspermin", user.get("maxrequestsperdmin", 0)))
	if per_minute > 0:
		min_interval = maxf(MIN_INTERVAL, 60.0 / per_minute)


func _game_result(jeu: Dictionary, system_id: int) -> Result:
	var result := Result.make(Result.Status.FOUND)
	var metadata := result.metadata
	var regions := _regions()
	var languages := [str(config.get("language", "en")), "en"]
	metadata.name = _pick_text(jeu.get("noms"), "region", regions)
	metadata.description = _pick_text(jeu.get("synopsis"), "langue", languages)
	var date := _pick_text(jeu.get("dates"), "region", regions)
	if date.left(4).is_valid_int():
		metadata.year = int(date.left(4))
	metadata.developer = _text(jeu.get("developpeur"))
	metadata.publisher = _text(jeu.get("editeur"))
	metadata.players = _text(jeu.get("joueurs"))
	var note := _text(jeu.get("note"))
	if note.is_valid_float():
		metadata.rating = clampf(float(note) / 20.0, 0.0, 1.0)
	var genres := PackedStringArray()
	for genre: Variant in jeu.get("genres", []):
		if genre is Dictionary:
			var genre_name := _pick_text(genre.get("noms"), "langue", languages)
			if not genre_name.is_empty() and genre_name not in genres:
				genres.append(genre_name)
	metadata.genre = ", ".join(genres.slice(0, 3))
	for key in metadata.keys():
		if metadata[key] is String and metadata[key].is_empty():
			metadata.erase(key)

	var medias: Variant = jeu.get("medias", [])
	for kind in GAME_MEDIA_TYPES:
		var types: Array = GAME_MEDIA_TYPES[kind]
		if kind == "boxart" and system_id in ARCADE_SYSTEMS:
			types = ["flyer"] + types
		var url := _media_url(medias, types)
		if not url.is_empty():
			result.media[kind] = url
	return result


## Region preference: the configured one, then the usual fallbacks.
func _regions() -> Array:
	var regions := [str(config.get("region", "us"))]
	for region in ["wor", "us", "eu", "ss", "jp"]:
		if region not in regions:
			regions.append(region)
	return regions


## From a list of { <field>: ..., "text": ... }, the text for the first of
## `wanted` that is there, else the first entry's text.
func _pick_text(entries: Variant, field: String, wanted: Array) -> String:
	if not entries is Array or entries.is_empty():
		return ""
	for value in wanted:
		for entry: Variant in entries:
			if entry is Dictionary and entry.get(field) == value:
				return str(entry.get("text", "")).strip_edges()
	return _text(entries[0])


## URL of the best media entry: types in order, regions in preference order,
## then any region.
func _media_url(medias: Variant, types: Array) -> String:
	if not medias is Array:
		return ""
	for type in types:
		var any_region := ""
		for region in _regions():
			for media: Variant in medias:
				if media is Dictionary and media.get("type") == type:
					if media.get("region", "") == region:
						return str(media.get("url", ""))
					if any_region.is_empty():
						any_region = str(media.get("url", ""))
		if not any_region.is_empty():
			return any_region
	return ""


static func _text(value: Variant) -> String:
	if value is Dictionary:
		return str(value.get("text", "")).strip_edges()
	return "" if value == null else str(value).strip_edges()


func _dev_id() -> String:
	var configured := str(config.get("dev_id", ""))
	return configured if not configured.is_empty() else DEV_ID


func _dev_password() -> String:
	var configured := str(config.get("dev_password", ""))
	return configured if not configured.is_empty() else DEV_PASSWORD
