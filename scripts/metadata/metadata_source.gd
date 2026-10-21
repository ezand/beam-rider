class_name MetadataSource
extends RefCounted
## Where metadata files (art etc.) come from: a local folder, a network share,
## an HTTP server... Files are addressed by relative paths like "NES/Metroid.png",
## so the rest of the app doesn't care which kind of source it is.
##
## To add a kind of source, subclass this, override read_file() and check(),
## give it TYPE, DISPLAY_NAME and FIELDS constants (see LocalFolderSource), and
## list it in MetadataSources.types(). The settings screen picks it up from there.
##
## read_file() and read_first() run on worker threads and may block (network
## sources will), so they must not touch nodes or shared state.

## Characters replaced by "_" in file names, as in the libretro thumbnail sets.
const UNSAFE_FILE_CHARS := "&*/:`<>?\\|\""

## The settings this source was created from: `type` plus the type's FIELDS.
var config: Dictionary


func _init(source_config := {}) -> void:
	config = source_config


## The contents of the file at `relative_path`, or an empty array if there is none.
func read_file(_relative_path: String) -> PackedByteArray:
	return PackedByteArray()


## Reads the first of `base_path`.<extension> that exists, trying extensions in
## order. Returns { "path", "data" }, or {} if none exists. Sources that can find
## the file in fewer round-trips (by listing a folder, say) can override this.
func read_first(base_path: String, extensions: PackedStringArray) -> Dictionary:
	for extension in extensions:
		var path := "%s.%s" % [base_path, extension]
		var data := read_file(path)
		if not data.is_empty():
			return { "path": path, "data": data }
	return {}


## Whether write_file() works, so a scraper can save art here.
func can_write() -> bool:
	return false


## Saves `data` at `relative_path`, creating folders. Returns true on success.
func write_file(_relative_path: String, _data: PackedByteArray) -> bool:
	return false


## Whether the source is set up and reachable, for the settings screen.
## Returns { "ok": bool, "message": String }. Called on the main thread.
func check() -> Dictionary:
	return { "ok": false, "message": "Not available" }


## Turns a platform or game name into a file name that is valid everywhere.
static func file_name(name: String) -> String:
	var result := name.strip_edges()
	for character in UNSAFE_FILE_CHARS:
		result = result.replace(character, "_")
	return result
