extends SceneTree
## Rebuilds the library database from data/library.json.
##
## godot --headless --path . --script res://tools/build_library.gd -- [--stress=10000] [--db=user://library.db]

const Builder := preload("res://scripts/library/library_builder.gd")


func _init() -> void:
	var stress := 0
	var path := "user://library.db"
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--stress="):
			stress = int(arg.get_slice("=", 1))
		elif arg.begins_with("--db="):
			path = arg.get_slice("=", 1)
	quit(0 if Builder.build(path, stress) else 1)
