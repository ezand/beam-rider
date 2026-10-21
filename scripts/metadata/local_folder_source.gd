class_name LocalFolderSource
extends MetadataSource
## Metadata files in a folder on this computer. A network share (SMB, NFS...)
## that the OS has mounted also works through this.

const TYPE := "local"
const DISPLAY_NAME := "Local folder"
## Settings this source needs. `kind` tells the settings screen which editor to use.
const FIELDS := [
	{ "key": "path", "label": "Folder", "kind": "folder" },
]

## Absolute path of the folder, or "" if none is set.
var root := ""


func _init(source_config := {}) -> void:
	super(source_config)
	root = expand_path(str(config.get("path", "")))


func read_file(relative_path: String) -> PackedByteArray:
	if root.is_empty():
		return PackedByteArray()
	var path := root.path_join(relative_path)
	if not FileAccess.file_exists(path):
		return PackedByteArray()
	return FileAccess.get_file_as_bytes(path)


func can_write() -> bool:
	return not root.is_empty()


func write_file(relative_path: String, data: PackedByteArray) -> bool:
	if root.is_empty():
		return false
	var path := root.path_join(relative_path)
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_warning("Could not write %s (error %d)" % [path, FileAccess.get_open_error()])
		return false
	file.store_buffer(data)
	return true


func check() -> Dictionary:
	if root.is_empty():
		return { "ok": false, "message": "No folder set. Cards show their name and color." }
	if not DirAccess.dir_exists_absolute(root):
		return { "ok": false, "message": "Folder not found. Cards show their name and color." }
	return { "ok": true, "message": "Folder found." }


## Makes `path` absolute: expands a leading "~" and Godot's user:// and res://.
static func expand_path(path: String) -> String:
	path = path.strip_edges()
	if path == "~" or path.begins_with("~/"):
		var home := OS.get_environment("USERPROFILE" if OS.get_name() == "Windows" else "HOME")
		path = home + path.substr(1)
	elif path.begins_with("user://") or path.begins_with("res://"):
		path = ProjectSettings.globalize_path(path)
	return path.simplify_path() if not path.is_empty() else ""
