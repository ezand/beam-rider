class_name Settings
extends RefCounted
## User settings, saved in user://settings.cfg. Every setting has a default, and
## only settings that differ from their default are written, so a missing or
## partial file is normal and later default changes still reach the user.

const PATH := "user://settings.cfg"

## Sections holding a metadata source config: { "type": ..., plus that type's FIELDS }.
const PLATFORM_METADATA := "platform_metadata"
const GAME_METADATA := "game_metadata"
const METADATA_SECTIONS: Array[String] = [PLATFORM_METADATA, GAME_METADATA]

var path := PATH

var _file := ConfigFile.new()


## Reads the settings file. A missing file just means all defaults.
func load_file(settings_path := PATH) -> void:
	path = settings_path
	_file = ConfigFile.new()
	if FileAccess.file_exists(path):
		var error := _file.load(path)
		if error != OK:
			push_warning("Could not read %s (error %d), using defaults" % [path, error])


func save() -> bool:
	var error := _file.save(path)
	if error != OK:
		push_error("Could not save %s (error %d)" % [path, error])
	return error == OK


## The metadata source config for `section`, with defaults filled in.
func get_metadata_source(section: String) -> Dictionary:
	var config := default_metadata_source(section)
	if _file.has_section(section):
		var type: String = _file.get_value(section, "type", config["type"])
		if type != config["type"]:
			config = { "type": type }
		for key in _file.get_section_keys(section):
			config[key] = _file.get_value(section, key)
	return config


func set_metadata_source(section: String, config: Dictionary) -> void:
	if _file.has_section(section):
		_file.erase_section(section)
	if config == default_metadata_source(section):
		return
	for key in config:
		_file.set_value(section, key, config[key])


## By default art is read from a "metadata" folder in the user data folder, so
## dropping files there works without opening the settings at all. Missing
## folders are fine: cards then show their name and color.
static func default_metadata_source(section: String) -> Dictionary:
	var folder := "platforms" if section == PLATFORM_METADATA else "games"
	return {
		"type": LocalFolderSource.TYPE,
		"path": OS.get_user_data_dir().path_join("metadata").path_join(folder),
	}
