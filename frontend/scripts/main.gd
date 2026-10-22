extends Node3D
## Two-level browser: a spinner of platforms, then a spinner of that platform's games.

## Emitted when the player picks a game. Nothing launches games yet.
signal game_launch_requested(platform: Dictionary, game: Dictionary)

const PLATFORM_ITEM_SIZE := Vector3(1.6, 1.0, 0.2)
const GAME_ITEM_SIZE := Vector3(1.0, 1.4, 0.15)

# Holding left/right repeats, speeding up the longer it is held.
const REPEAT_DELAY := 0.35
const REPEAT_SLOWEST := 0.12
const REPEAT_FASTEST := 0.02
const REPEAT_RAMP := 2.5

@export var database_path := "user://library.db"
## When the database is (re)built from data/library.json, also add a
## "Stress Test" platform with this many generated games. 0 = off.
@export var stress_test_games := 10000

var library := GameLibrary.new()
var settings := Settings.new()
## Art for platform and game cards, each from its own configurable source.
var platform_art := ArtLoader.new()
var game_art := ArtLoader.new()
var library_scraper := LibraryScraper.new()
## Rows from the platforms table, in display order.
var platforms: Array = []
## Index into `platforms` being browsed, or -1 while browsing platforms.
var current_platform := -1
## The current platform's game list (id, name, sort_name, year), sorted.
var games: Array = []
## Filled by the background query started in _activate().
var _loaded_games: Array = []

var _transitioning := false
var _hold_direction := 0
var _hold_time := 0.0
var _repeat_timer := 0.0
var _debug_label: Label
var _settings_menu: SettingsMenu
var _scrape_label: Label
## Art key -> index of the item using it in the current view, so a card can be
## refreshed when its art finishes loading.
var _art_keys := {}

@onready var spinner: Spinner = $Spinner
@onready var title_label: Label = %TitleLabel
@onready var info_label: Label = %InfoLabel


func _ready() -> void:
	_open_library()
	platforms = library.get_platforms()
	print("Loaded %d platforms in %.2f ms" % [platforms.size(), library.last_query_msec])
	settings.load_file()
	for loader in [platform_art, game_art]:
		add_child(loader)
		loader.art_loaded.connect(_on_art_loaded)
	_apply_metadata_settings()
	_create_debug_overlay()
	_create_scrape_status()
	add_child(library_scraper)
	library_scraper.art_saved.connect(_on_art_saved)
	library_scraper.progress.connect(_on_scrape_progress)
	library_scraper.finished.connect(_on_scrape_finished)
	_settings_menu = SettingsMenu.new(settings, library_scraper)
	_settings_menu.saved.connect(_apply_metadata_settings)
	_settings_menu.scrape_requested.connect(_start_scrape)
	$UI.add_child(_settings_menu)
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
	elif _transitioning or _settings_menu.visible:
		return
	elif _is_key(event, KEY_TAB) or _is_joy_button(event, JOY_BUTTON_START):
		_settings_menu.open()
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
	if not _transitioning and not _settings_menu.visible:
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
	if current_platform == -1:
		return String(platforms[index]["name"]).left(1).to_upper()
	return String(games[index]["sort_name"]).left(1).to_upper()


## Opens the database, building it from data/library.json first if it is
## missing or has an old schema. The auto-build is for development only: once
## the backend owns the database, a missing database should be an error screen.
func _open_library() -> void:
	if FileAccess.file_exists(database_path) and library.open(database_path):
		if library.schema_version() == GameLibrary.SCHEMA_VERSION:
			return
		library.close()
	LibraryBuilder.build(database_path, stress_test_games)
	library.open(database_path)


func _activate() -> void:
	if platforms.is_empty():
		return
	if current_platform == -1:
		var index := spinner.selected
		if int(platforms[index]["game_count"]) == 0:
			info_label.text = "No games for %s yet" % platforms[index]["name"]
			return
		# Query on a worker thread while the spinner shrinks away, so a large
		# platform never stalls a frame. _show_games waits for it if needed.
		var platform_id := int(platforms[index]["id"])
		var task := WorkerThreadPool.add_task(
				func() -> void: _loaded_games = library.get_games(platform_id),
				false, "Load games")
		_transition(_show_games.bind(index, task))
	else:
		var platform: Dictionary = platforms[current_platform]
		var game: Dictionary = games[spinner.selected]
		info_label.text = "Launching %s…" % game["name"]
		game_launch_requested.emit(platform, game)


func _back() -> void:
	if current_platform != -1:
		_transition(_show_platforms.bind(current_platform))


func _show_platforms(start_index: int) -> void:
	current_platform = -1
	games = []
	_art_keys.clear()
	spinner.item_size = PLATFORM_ITEM_SIZE
	spinner.item_spacing = 2.1
	spinner.set_source(platforms.size(), _platform_card, start_index)


## `load_task` is the WorkerThreadPool task filling `_loaded_games`.
func _show_games(platform_index: int, load_task: int) -> void:
	var waited := Time.get_ticks_usec()
	WorkerThreadPool.wait_for_task_completion(load_task)
	current_platform = platform_index
	games = _loaded_games
	_loaded_games = []
	print("Loaded %d games for %s in %.2f ms (main thread waited %.2f ms)" % [
			games.size(), platforms[platform_index]["name"], library.last_query_msec,
			(Time.get_ticks_usec() - waited) / 1000.0])
	_art_keys.clear()
	spinner.item_size = GAME_ITEM_SIZE
	spinner.item_spacing = 1.5
	spinner.set_source(games.size(), _game_card, 0)


## Builds card data for one platform. Called by the spinner only when it shows.
func _platform_card(index: int) -> Dictionary:
	var platform: Dictionary = platforms[index]
	var art_key := MetadataSource.file_name(platform["name"])
	_art_keys[art_key] = index
	return {
		"name": platform["name"],
		"subtitle": "%s · %s" % [platform.get("maker", ""), _year(platform)],
		"color": platform.get("color", "#888888"),
		"art": platform_art.request(art_key),
	}


## Builds card data for one game of the current platform.
func _game_card(index: int) -> Dictionary:
	var game: Dictionary = games[index]
	var base := Color(platforms[current_platform].get("color", "#888888"))
	var color := Color.from_hsv(fposmod(base.h + (index % 7) * 0.04, 1.0), base.s * 0.85,
			clampf(base.v * (0.75 + 0.1 * (index % 3)), 0.0, 1.0))
	var art_key := "%s/%s" % [MetadataSource.file_name(platforms[current_platform]["name"]),
			MetadataSource.file_name(game["name"])]
	_art_keys[art_key] = index
	return { "name": game["name"], "subtitle": _year(game), "color": color,
			"art": game_art.request(art_key) }


## (Re)creates the art sources from settings. Cards without art keep showing
## their name and color, so an empty or missing source is not an error.
func _apply_metadata_settings() -> void:
	platform_art.source = MetadataSources.create(settings.get_config(Settings.PLATFORM_METADATA))
	game_art.source = MetadataSources.create(settings.get_config(Settings.GAME_METADATA))
	spinner.refresh()


func _on_art_loaded(key: String) -> void:
	if _art_keys.has(key):
		spinner.refresh(_art_keys[key])


## Scrapes the library in the background with the saved scraper settings.
## Art is saved into the metadata sources the cards read from.
func _start_scrape() -> void:
	var scraper := Scrapers.create(settings.get_config(Settings.SCRAPER))
	if scraper == null:
		return
	library_scraper.start(ScrapeJob.new(database_path, scraper,
			platform_art.source, game_art.source))


## New art replaces a cached "no art" result and shows on its card right away.
func _on_art_saved(scope: String, key: String) -> void:
	var loader := platform_art if scope == "platform" else game_art
	loader.forget(key)
	if _art_keys.has(key):
		spinner.refresh(_art_keys[key])


func _on_scrape_progress(done: int, total: int, text: String) -> void:
	_scrape_label.text = "Scraping %d / %d  ·  %s" % [done + 1, total, text]
	_scrape_label.visible = true


func _on_scrape_finished(summary: Dictionary) -> void:
	_scrape_label.text = "Scraping done: %d found, %d not found%s" % [
			summary.found, summary.not_found,
			"  ·  " + summary.message if summary.message else ""]
	get_tree().create_timer(6.0).timeout.connect(func() -> void:
			if not library_scraper.is_running():
				_scrape_label.visible = false)


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
		info_label.text = "%s  ·  %d games" % [platform["name"], int(platform["game_count"])]
	else:
		var platform: Dictionary = platforms[current_platform]
		var game: Dictionary = games[index]
		title_label.text = "PLATFORMS  ›  %s" % String(platform["name"]).to_upper()
		info_label.text = "%s  ·  %s      %d / %d" % [
				game["name"], _year(game), index + 1, games.size()]


func _year(entry: Dictionary) -> String:
	var year: Variant = entry.get("year")
	return "" if year == null or int(year) == 0 else str(int(year))


func _exit_tree() -> void:
	library.close()


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


func _create_scrape_status() -> void:
	_scrape_label = Label.new()
	_scrape_label.visible = false
	_scrape_label.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT)
	_scrape_label.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_scrape_label.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_scrape_label.position += Vector2(-40, -80)
	_scrape_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_scrape_label.add_theme_font_size_override("font_size", 16)
	_scrape_label.add_theme_color_override("font_color", Color(1, 1, 1, 0.6))
	$UI.add_child(_scrape_label)


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


func _is_key(event: InputEvent, keycode: Key) -> bool:
	return event is InputEventKey and event.pressed and not event.echo and event.keycode == keycode


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
