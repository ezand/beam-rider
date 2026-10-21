class_name LibraryBuilder
extends RefCounted
## Builds the library database from data/library.json, optionally adding a
## platform of generated games for stress testing.
##
## This is a stand-in for the real backend, which will scan ROM folders and
## fetch metadata. The frontend only ever reads the database.

const JSON_PATH := "res://data/library.json"
const STRESS_PLATFORM_NAME := "Stress Test"


## Replaces the database at `path`. Returns true on success.
static func build(path: String, stress_games := 0, json_path := JSON_PATH) -> bool:
	var started := Time.get_ticks_usec()
	var platforms := _load_json(json_path)
	if stress_games > 0:
		platforms.append(_make_stress_platform(stress_games))

	var absolute := ProjectSettings.globalize_path(path)
	if FileAccess.file_exists(path):
		DirAccess.remove_absolute(absolute)
	DirAccess.make_dir_recursive_absolute(absolute.get_base_dir())

	var library := GameLibrary.new()
	if not library.open(path):
		return false
	for statement in GameLibrary.SCHEMA:
		if not library.execute(statement):
			library.close()
			return false

	var platform_rows := []
	var game_rows := []
	for i in platforms.size():
		var platform: Dictionary = platforms[i]
		var platform_id := i + 1
		platform_rows.append({
			"id": platform_id,
			"name": platform["name"],
			"maker": platform.get("maker", ""),
			"year": int(platform.get("year", 0)),
			"color": platform.get("color", "#888888"),
			"sort_order": i,
		})
		for game in platform.get("games", []):
			game_rows.append({
				"platform_id": platform_id,
				"name": game["name"],
				"sort_name": GameLibrary.make_sort_name(game["name"]),
				"year": int(game.get("year", 0)),
			})

	var ok := library.insert_rows("platforms", platform_rows) \
			and library.insert_rows("games", game_rows)
	library.close()
	print("Built library %s: %d platforms, %d games in %.0f ms" % [
			path, platform_rows.size(), game_rows.size(),
			(Time.get_ticks_usec() - started) / 1000.0])
	return ok


static func _load_json(json_path: String) -> Array:
	var file := FileAccess.open(json_path, FileAccess.READ)
	if file == null:
		push_error("Could not open %s" % json_path)
		return []
	var data: Variant = JSON.parse_string(file.get_as_text())
	if data is Dictionary:
		return data.get("platforms", [])
	push_error("%s is not valid library JSON" % json_path)
	return []


static func _make_stress_platform(count: int) -> Dictionary:
	var adjectives := ["Super", "Mega", "Ultra", "Hyper", "Turbo", "Final", "Dark", "Cosmic",
			"Neon", "Iron", "Crystal", "Shadow", "Golden", "Wild", "Silent", "Atomic",
			"Brave", "Crimson", "Electric", "Frozen", "Grand", "Lost", "Mystic", "Quantum"]
	var nouns := ["Quest", "Fighter", "Racer", "Legend", "Saga", "Warrior", "Odyssey", "Blaster",
			"Knight", "Dragon", "Pilot", "Ninja", "Kart", "Tactics", "Dungeon", "Galaxy",
			"Hunter", "Islands", "Machine", "Rebellion", "Strike", "Tower", "Voyage", "Zone"]
	var rng := RandomNumberGenerator.new()
	rng.seed = 64
	var games := []
	games.resize(count)
	for i in count:
		games[i] = {
			"name": "%s %s %d" % [adjectives[rng.randi() % adjectives.size()],
					nouns[rng.randi() % nouns.size()], rng.randi_range(1, 99)],
			"year": rng.randi_range(1977, 2004),
		}
	return { "name": STRESS_PLATFORM_NAME, "maker": "Generated", "year": 2026,
			"color": "#00b3a4", "games": games }
