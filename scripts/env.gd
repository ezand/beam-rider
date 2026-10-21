class_name Env
extends RefCounted
## Values from the environment, or from a .env file in the project folder, for
## secrets that must not be committed (API credentials). Environment variables
## win over the file. .env is gitignored; .env.example lists the keys.
##
## The file is read from the project folder, so it works when running from the
## editor or with `godot --path .`. Exported builds don't include it: set the
## environment variables there instead.

const PATH := "res://.env"

static var _file_values: Dictionary = {}
static var _loaded := false
static var _mutex := Mutex.new()


## The value of `key`, or `default` if it isn't set or is empty.
static func value(key: String, default := "") -> String:
	var from_environment := OS.get_environment(key)
	if not from_environment.is_empty():
		return from_environment
	_mutex.lock()
	if not _loaded:
		_file_values = parse(FileAccess.get_file_as_string(PATH)) if FileAccess.file_exists(PATH) else {}
		_loaded = true
	var from_file: String = _file_values.get(key, "")
	_mutex.unlock()
	return from_file if not from_file.is_empty() else default


## Parses KEY=value lines. Blank lines and # comments are skipped, an optional
## "export " prefix is allowed, and values may be wrapped in single or double quotes.
static func parse(text: String) -> Dictionary:
	var values := {}
	for raw_line in text.split("\n"):
		var line := raw_line.strip_edges()
		if line.is_empty() or line.begins_with("#"):
			continue
		if line.begins_with("export "):
			line = line.substr(7).strip_edges()
		var equals := line.find("=")
		if equals <= 0:
			continue
		var key := line.substr(0, equals).strip_edges()
		var val := line.substr(equals + 1).strip_edges()
		if val.length() >= 2 and val[0] == val[-1] and val[0] in ["\"", "'"]:
			val = val.substr(1, val.length() - 2)
		values[key] = val
	return values
