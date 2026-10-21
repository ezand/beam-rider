extends Node3D
## Two-level browser: a spinner of platforms, then a spinner of that platform's games.

## Emitted when the player picks a game. Nothing launches games yet.
signal game_launch_requested(platform: Dictionary, game: Dictionary)

const LIBRARY_PATH := "res://data/library.json"
const PLATFORM_ITEM_SIZE := Vector3(1.6, 1.0, 0.2)
const GAME_ITEM_SIZE := Vector3(1.0, 1.4, 0.15)

# Holding left/right repeats, speeding up the longer it is held.
const REPEAT_DELAY := 0.35
const REPEAT_SLOWEST := 0.12
const REPEAT_FASTEST := 0.02
const REPEAT_RAMP := 2.5

## Adds a "Stress Test" platform with this many generated games. 0 = off.
@export var stress_test_games := 10000

var platforms: Array = []
## Index of the platform being browsed, or -1 while browsing platforms.
var current_platform := -1

var _transitioning := false
var _hold_direction := 0
var _hold_time := 0.0
var _repeat_timer := 0.0
var _debug_label: Label

@onready var spinner: Spinner = $Spinner
@onready var title_label: Label = %TitleLabel
@onready var info_label: Label = %InfoLabel


func _ready() -> void:
	platforms = _load_library()
	if stress_test_games > 0:
		platforms.append(_make_stress_platform(stress_test_games))
	_create_debug_overlay()
	spinner.selection_changed.connect(_on_selection_changed)
	_show_platforms(0)


func _process(delta: float) -> void:
	_update_held_navigation(delta)
	if _debug_label.visible:
		_update_debug_overlay()


func _unhandled_input(event: InputEvent) -> void:
	if _is_fullscreen_toggle(event):
		_toggle_fullscreen()
	elif event is InputEventKey and event.pressed and not event.echo \
			and event.keycode == KEY_F3:
		_debug_label.visible = not _debug_label.visible
	elif _transitioning:
		return
	elif event.is_action_pressed("ui_accept"):
		_activate()
	elif event.is_action_pressed("ui_cancel"):
		_back()
	elif event.is_action_pressed("ui_page_up") or _is_joy_button(event, JOY_BUTTON_LEFT_SHOULDER):
		_jump_letter(-1)
	elif event.is_action_pressed("ui_page_down") or _is_joy_button(event, JOY_BUTTON_RIGHT_SHOULDER):
		_jump_letter(1)
	elif event is InputEventMouseButton and event.pressed \
			and event.button_index == MOUSE_BUTTON_WHEEL_UP:
		spinner.move(-1)
	elif event is InputEventMouseButton and event.pressed \
			and event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		spinner.move(1)
	else:
		return
	get_viewport().set_input_as_handled()


## Left/right are polled rather than read from events so holding a direction
## can repeat on our own accelerating schedule instead of the OS key repeat.
func _update_held_navigation(delta: float) -> void:
	var direction := 0
	if not _transitioning:
		direction = int(Input.is_action_pressed("ui_right")) - int(Input.is_action_pressed("ui_left"))
	if direction == 0:
		_hold_direction = 0
		return
	if direction != _hold_direction:
		_hold_direction = direction
		_hold_time = 0.0
		_repeat_timer = REPEAT_DELAY
		spinner.move(direction)
		return
	_hold_time += delta
	_repeat_timer -= delta
	while _repeat_timer <= 0.0:
		spinner.move(direction)
		var ramp := clampf((_hold_time - REPEAT_DELAY) / REPEAT_RAMP, 0.0, 1.0)
		_repeat_timer += lerpf(REPEAT_SLOWEST, REPEAT_FASTEST, ramp * ramp)


## Jumps to the first item whose name starts with the next (or previous) letter.
func _jump_letter(direction: int) -> void:
	var count := spinner.item_count
	if count < 2:
		return
	var start := spinner.selected
	var current := _initial(start)
	var index := start
	for _i in count:
		index = posmod(index + direction, count)
		if _initial(index) != current:
			break
	if direction < 0:
		var letter := _initial(index)
		while posmod(index - 1, count) != start and _initial(posmod(index - 1, count)) == letter:
			index = posmod(index - 1, count)
	spinner.jump_to(index)


func _initial(index: int) -> String:
	var entries: Array = platforms if current_platform == -1 \
			else platforms[current_platform]["games"]
	return String(entries[index]["name"]).left(1).to_upper()


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
	spinner.item_size = PLATFORM_ITEM_SIZE
	spinner.item_spacing = 2.1
	spinner.set_source(platforms.size(), _platform_card, start_index)


func _show_games(platform_index: int) -> void:
	current_platform = platform_index
	var games: Array = platforms[platform_index].get("games", [])
	spinner.item_size = GAME_ITEM_SIZE
	spinner.item_spacing = 1.5
	spinner.set_source(games.size(), _game_card, 0)


## Builds card data for one platform. Called by the spinner only when it shows.
func _platform_card(index: int) -> Dictionary:
	var platform: Dictionary = platforms[index]
	return {
		"name": platform["name"],
		"subtitle": "%s · %s" % [platform.get("maker", ""), _year(platform)],
		"color": platform.get("color", "#888888"),
	}


## Builds card data for one game of the current platform.
func _game_card(index: int) -> Dictionary:
	var platform: Dictionary = platforms[current_platform]
	var game: Dictionary = platform["games"][index]
	var color: Variant = game.get("color")
	if color == null:
		var base := Color(platform.get("color", "#888888"))
		color = Color.from_hsv(fposmod(base.h + (index % 7) * 0.04, 1.0), base.s * 0.85,
				clampf(base.v * (0.75 + 0.1 * (index % 3)), 0.0, 1.0))
	return { "name": game["name"], "subtitle": _year(game), "color": color }


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
		var games: Array = platform["games"]
		var game: Dictionary = games[index]
		title_label.text = "PLATFORMS  ›  %s" % String(platform["name"]).to_upper()
		info_label.text = "%s  ·  %s      %d / %d" % [
				game["name"], _year(game), index + 1, games.size()]


## JSON numbers load as floats, so format years as whole numbers.
func _year(entry: Dictionary) -> String:
	return str(int(entry["year"])) if entry.has("year") else ""


func _make_stress_platform(count: int) -> Dictionary:
	var started := Time.get_ticks_usec()
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
	games.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return String(a["name"]).naturalnocasecmp_to(b["name"]) < 0)
	print("Generated %d stress-test games in %.1f ms"
			% [count, (Time.get_ticks_usec() - started) / 1000.0])
	return { "name": "Stress Test", "maker": "Generated", "year": 2026, "color": "#00b3a4",
			"games": games }


func _create_debug_overlay() -> void:
	_debug_label = Label.new()
	_debug_label.visible = false
	_debug_label.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	_debug_label.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_debug_label.position += Vector2(-40, 32)
	_debug_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_debug_label.add_theme_font_size_override("font_size", 16)
	_debug_label.add_theme_color_override("font_color", Color(0.6, 1.0, 0.6))
	$UI.add_child(_debug_label)


func _update_debug_overlay() -> void:
	_debug_label.text = "%d fps  ·  spinner %.3f ms  ·  %d binds\n%d draw calls  ·  %d objects\n%d nodes  ·  %d items" % [
		Performance.get_monitor(Performance.TIME_FPS),
		spinner.last_update_usec / 1000.0,
		spinner.total_binds,
		Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
		Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),
		Performance.get_monitor(Performance.OBJECT_NODE_COUNT),
		spinner.item_count,
	]


func _is_joy_button(event: InputEvent, button: JoyButton) -> bool:
	return event is InputEventJoypadButton and event.pressed and event.button_index == button


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
