class_name Settings
extends RefCounted
## User settings, saved in user://settings.cfg. Every setting has a default, and
## only settings that differ from their default are written, so a missing or
## partial file is normal and later default changes still reach the user.
##
## Each section holds one provider config: { "type": ..., plus that type's
## fields }. Metadata sections use MetadataSources types, the scraper section
## Scrapers types.

const PATH := "user://settings.cfg"

const PLATFORM_METADATA := "platform_metadata"
const GAME_METADATA := "game_metadata"
const SCRAPER := "scraper"

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


## The config for `section`, with defaults filled in.
func get_config(section: String) -> Dictionary:
	var config := default_config(section)
	if _file.has_section(section):
		var type: String = _file.get_value(section, "type", config["type"])
		if type != config["type"]:
			config = default_config(section, type)
		for key in _file.get_section_keys(section):
			config[key] = _file.get_value(section, key)
	return config


func set_config(section: String, config: Dictionary) -> void:
	if _file.has_section(section):
		_file.erase_section(section)
	var defaults := default_config(section, str(config.get("type", "")))
	if config == default_config(section):
		return
	for key in config:
		if key == "type" or config[key] != defaults.get(key):
			_file.set_value(section, key, config[key])


## Defaults for `section`, for its default type or the given `type`.
##
## By default art is read from (and scraped into) a "metadata" folder in the
## user data folder, so dropping files there works without opening the
## settings at all. Missing folders are fine: cards show their name and color.
static func default_config(section: String, type := "") -> Dictionary:
	if section == SCRAPER:
		var script := Scrapers.find_type(type) if not type.is_empty() else ScreenScraper
		return _field_defaults(script, Scrapers.fields_of(script) if script else [])
	var folder := "platforms" if section == PLATFORM_METADATA else "games"
	var config := _field_defaults(MetadataSources.find_type(type) if not type.is_empty()
			else LocalFolderSource, [])
	if config["type"] == LocalFolderSource.TYPE:
		config["path"] = OS.get_user_data_dir().path_join("metadata").path_join(folder)
	return config


## { "type": ..., plus each field's "default" }. `fields` defaults to the script's FIELDS.
static func _field_defaults(script: GDScript, fields: Array) -> Dictionary:
	if script == null:
		return { "type": "" }
	var config := { "type": script.TYPE }
	for field: Dictionary in (fields if not fields.is_empty() else script.FIELDS):
		config[field.key] = field.get("default", "")
	return config
