extends Node3D
## Two-level browser: a spinner of platforms, then a spinner of that platform's games.

## Emitted when the player picks a game. Nothing launches games yet.
signal game_launch_requested(platform: Dictionary, game: Dictionary)

const LIBRARY_PATH := "res://data/library.json"
const PLATFORM_ITEM_SIZE := Vector3(1.6, 1.0, 0.2)
const GAME_ITEM_SIZE := Vector3(1.0, 1.4, 0.15)

var platforms: Array = []
## Index of the platform being browsed, or -1 while browsing platforms.
var current_platform := -1

var _transitioning := false

@onready var spinner: Spinner = $Spinner
@onready var title_label: Label = %TitleLabel
@onready var info_label: Label = %InfoLabel


func _ready() -> void:
	platforms = _load_library()
	spinner.selection_changed.connect(_on_selection_changed)
	_show_platforms(0)


func _unhandled_input(event: InputEvent) -> void:
	if _is_fullscreen_toggle(event):
		_toggle_fullscreen()
		get_viewport().set_input_as_handled()
		return
	if _transitioning:
		return
	if event.is_action_pressed("ui_left", true):
		spinner.move(-1)
	elif event.is_action_pressed("ui_right", true):
		spinner.move(1)
	elif event.is_action_pressed("ui_accept"):
		_activate()
	elif event.is_action_pressed("ui_cancel"):
		_back()
	elif event is InputEventMouseButton and event.pressed \
			and event.button_index == MOUSE_BUTTON_WHEEL_UP:
		spinner.move(-1)
	elif event is InputEventMouseButton and event.pressed \
			and event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		spinner.move(1)
	else:
		return
	get_viewport().set_input_as_handled()


## F11 or Alt+Enter.
func _is_fullscreen_toggle(event: InputEvent) -> bool:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return false
	return event.keycode == KEY_F11 or (event.keycode == KEY_ENTER and event.alt_pressed)


func _toggle_fullscreen() -> void:
	var fullscreen := DisplayServer.window_get_mode() in [
			DisplayServer.WINDOW_MODE_FULLSCREEN, DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN]
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED if fullscreen
			else DisplayServer.WINDOW_MODE_FULLSCREEN)


func _load_library() -> Array:
	var file := FileAccess.open(LIBRARY_PATH, FileAccess.READ)
	if file == null:
		push_error("Could not open %s" % LIBRARY_PATH)
		return []
	var data: Variant = JSON.parse_string(file.get_as_text())
	if data is Dictionary:
		return data.get("platforms", [])
	push_error("%s is not valid library JSON" % LIBRARY_PATH)
	return []


func _activate() -> void:
	if platforms.is_empty():
		return
	if current_platform == -1:
		var index := spinner.selected
		if platforms[index].get("games", []).is_empty():
			info_label.text = "No games for %s yet" % platforms[index]["name"]
			return
		_transition(_show_games.bind(index))
	else:
		var platform: Dictionary = platforms[current_platform]
		var game: Dictionary = platform["games"][spinner.selected]
		info_label.text = "Launching %s…" % game["name"]
		game_launch_requested.emit(platform, game)


func _back() -> void:
	if current_platform != -1:
		_transition(_show_platforms.bind(current_platform))


func _show_platforms(start_index: int) -> void:
	current_platform = -1
	var items := []
	for platform in platforms:
		items.append({
			"name": platform["name"],
			"subtitle": "%s · %s" % [platform.get("maker", ""), _year(platform)],
			"color": platform.get("color", "#888888"),
		})
	spinner.item_size = PLATFORM_ITEM_SIZE
	spinner.item_spacing = 2.1
	spinner.set_items(items, start_index)


func _show_games(platform_index: int) -> void:
	current_platform = platform_index
	var platform: Dictionary = platforms[platform_index]
	var base := Color(platform.get("color", "#888888"))
	var items := []
	var games: Array = platform.get("games", [])
	for i in games.size():
		var game: Dictionary = games[i]
		var shade := Color.from_hsv(fposmod(base.h + i * 0.04, 1.0), base.s * 0.85,
				clampf(base.v * (0.75 + 0.1 * (i % 3)), 0.0, 1.0))
		items.append({
			"name": game["name"],
			"subtitle": _year(game),
			"color": game.get("color", shade),
		})
	spinner.item_size = GAME_ITEM_SIZE
	spinner.item_spacing = 1.5
	spinner.set_items(items, 0)


## Shrinks the spinner away, runs `rebuild`, then grows it back.
func _transition(rebuild: Callable) -> void:
	_transitioning = true
	var tween := create_tween().set_trans(Tween.TRANS_CUBIC)
	tween.tween_property(spinner, "scale", Vector3.ONE * 0.01, 0.18).set_ease(Tween.EASE_IN)
	tween.tween_callback(rebuild)
	tween.tween_property(spinner, "scale", Vector3.ONE, 0.28).set_ease(Tween.EASE_OUT)
	tween.tween_callback(func() -> void: _transitioning = false)


func _on_selection_changed(index: int) -> void:
	if current_platform == -1:
		var platform: Dictionary = platforms[index]
		title_label.text = "PLATFORMS"
		info_label.text = "%s  ·  %d games" % [platform["name"], platform.get("games", []).size()]
	else:
		var platform: Dictionary = platforms[current_platform]
		var game: Dictionary = platform["games"][index]
		title_label.text = "PLATFORMS  ›  %s" % platform["name"].to_upper()
		info_label.text = "%s  ·  %s" % [game["name"], _year(game)]


## JSON numbers load as floats, so format years as whole numbers.
func _year(entry: Dictionary) -> String:
	return str(int(entry["year"])) if entry.has("year") else ""
