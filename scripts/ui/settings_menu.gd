class_name SettingsMenu
extends Control
## Overlay for editing Settings: where platform and game metadata comes from.
##
## Each section's fields are built from the FIELDS of the chosen MetadataSource
## type, so a new source type gets its settings UI without changes here.
## Works with mouse, keyboard and gamepad. Esc / B closes without saving.

signal saved
signal closed

const ACCENT := Color(0.55, 0.85, 1.0)
const DIM_TEXT := Color(1, 1, 1, 0.55)
const OK_COLOR := Color(0.55, 0.95, 0.6)
const WARN_COLOR := Color(1.0, 0.75, 0.4)
const LABEL_WIDTH := 110

const SECTIONS := [
	{
		"id": Settings.PLATFORM_METADATA,
		"title": "Platform metadata",
		"help": "Art for platform cards, named after the platform: NES.png, Mega Drive.jpg …",
	},
	{
		"id": Settings.GAME_METADATA,
		"title": "Game metadata",
		"help": "Art for game cards, in a folder per platform: NES/Metroid.png …",
	},
]

var settings: Settings

## Section id -> the source config being edited. Saved only on Save.
var _configs := {}
## Section id -> OptionButton choosing the source type.
var _type_buttons := {}
## Section id -> VBoxContainer holding the type's field editors.
var _field_boxes := {}
## Section id -> Label showing MetadataSource.check().
var _status_labels := {}
var _folder_dialog: FileDialog
## [section id, field key, LineEdit] the folder dialog is choosing for.
var _browse_target: Array = []


func _init(app_settings: Settings) -> void:
	settings = app_settings
	visible = false
	set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	theme = Theme.new()
	theme.default_font_size = 20
	_build()


func open() -> void:
	for section in SECTIONS:
		_configs[section.id] = settings.get_metadata_source(section.id).duplicate()
		_show_config(section.id)
	visible = true
	(_type_buttons[SECTIONS[0].id] as Control).grab_focus()


func close() -> void:
	visible = false
	get_viewport().gui_release_focus()
	closed.emit()


func _unhandled_input(event: InputEvent) -> void:
	if visible and event.is_action_pressed("ui_cancel"):
		close()
		get_viewport().set_input_as_handled()


func _build() -> void:
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.65)
	dim.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	add_child(dim)

	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	add_child(center)

	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(1000, 0)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.05, 0.06, 0.11, 0.97)
	style.border_color = Color(ACCENT, 0.5)
	style.set_border_width_all(2)
	style.set_corner_radius_all(14)
	style.set_content_margin_all(32)
	panel.add_theme_stylebox_override("panel", style)
	center.add_child(panel)

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 26)
	panel.add_child(box)

	var title := Label.new()
	title.text = "SETTINGS"
	title.add_theme_color_override("font_color", ACCENT)
	title.add_theme_font_size_override("font_size", 28)
	box.add_child(title)

	for section in SECTIONS:
		box.add_child(_build_section(section))

	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 12)
	buttons.add_child(_make_button("Reset to defaults", _on_reset_pressed))
	var spacer := Control.new()
	spacer.size_flags_horizontal = SIZE_EXPAND_FILL
	buttons.add_child(spacer)
	buttons.add_child(_make_button("Cancel", close))
	buttons.add_child(_make_button("Save", _on_save_pressed))
	box.add_child(buttons)

	_folder_dialog = FileDialog.new()
	_folder_dialog.title = "Choose metadata folder"
	_folder_dialog.file_mode = FileDialog.FILE_MODE_OPEN_DIR
	_folder_dialog.access = FileDialog.ACCESS_FILESYSTEM
	_folder_dialog.use_native_dialog = true
	_folder_dialog.dir_selected.connect(_on_folder_selected)
	add_child(_folder_dialog)


func _build_section(section: Dictionary) -> Control:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)

	var heading := Label.new()
	heading.text = section.title
	heading.add_theme_font_size_override("font_size", 24)
	box.add_child(heading)

	var help := Label.new()
	help.text = section.help
	help.add_theme_color_override("font_color", DIM_TEXT)
	box.add_child(help)

	var type_button := OptionButton.new()
	for script in MetadataSources.types():
		type_button.add_item(script.DISPLAY_NAME)
	type_button.item_selected.connect(_on_type_selected.bind(section.id))
	box.add_child(_make_row("Source", type_button))
	_type_buttons[section.id] = type_button

	var fields := VBoxContainer.new()
	fields.add_theme_constant_override("separation", 10)
	box.add_child(fields)
	_field_boxes[section.id] = fields

	var status := Label.new()
	status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(status)
	_status_labels[section.id] = status
	return box


## Rebuilds a section's editors from its config being edited.
func _show_config(section_id: String) -> void:
	var config: Dictionary = _configs[section_id]
	var script := MetadataSources.find_type(str(config.get("type", "")))
	var type_button: OptionButton = _type_buttons[section_id]
	type_button.select(MetadataSources.types().find(script))

	var fields: VBoxContainer = _field_boxes[section_id]
	for child in fields.get_children():
		fields.remove_child(child)
		child.queue_free()
	if script:
		for field: Dictionary in script.FIELDS:
			fields.add_child(_build_field(section_id, field))
	_update_status(section_id)


func _build_field(section_id: String, field: Dictionary) -> Control:
	var key: String = field.key
	var edit := LineEdit.new()
	var value := str(_configs[section_id].get(key, ""))
	edit.text = _abbreviate_home(value) if field.get("kind") == "folder" else value
	edit.tooltip_text = value
	edit.size_flags_horizontal = SIZE_EXPAND_FILL
	edit.select_all_on_focus = true
	edit.text_changed.connect(func(text: String) -> void: _configs[section_id][key] = text)
	edit.text_submitted.connect(func(_text: String) -> void: _update_status(section_id))
	edit.focus_exited.connect(_update_status.bind(section_id))
	var row := _make_row(field.label, edit)
	if field.get("kind") == "folder":
		edit.placeholder_text = "No folder: cards show their name and color"
		row.add_child(_make_button("Browse…", _on_browse_pressed.bind(section_id, key, edit)))
		row.add_child(_make_button("Open", _on_open_pressed.bind(section_id, key)))
	return row


func _update_status(section_id: String) -> void:
	var source := MetadataSources.create(_configs[section_id])
	var result := source.check() if source else { "ok": false, "message": "Unknown source type." }
	var label: Label = _status_labels[section_id]
	label.text = result.message
	label.add_theme_color_override("font_color", OK_COLOR if result.ok else WARN_COLOR)


func _on_type_selected(index: int, section_id: String) -> void:
	_configs[section_id]["type"] = MetadataSources.types()[index].TYPE
	_show_config(section_id)


func _on_browse_pressed(section_id: String, key: String, edit: LineEdit) -> void:
	_browse_target = [section_id, key, edit]
	var current := LocalFolderSource.expand_path(edit.text)
	_folder_dialog.current_dir = current if DirAccess.dir_exists_absolute(current) \
			else LocalFolderSource.expand_path("~")
	_folder_dialog.popup_centered_ratio(0.6)


func _on_folder_selected(dir: String) -> void:
	var section_id: String = _browse_target[0]
	var edit: LineEdit = _browse_target[2]
	edit.text = _abbreviate_home(dir)
	edit.tooltip_text = dir
	_configs[section_id][_browse_target[1]] = dir
	_update_status(section_id)


## Shows the folder in the file manager, creating it first, so the user can
## drop art into the default folder without hunting for it.
func _on_open_pressed(section_id: String, key: String) -> void:
	var path := LocalFolderSource.expand_path(str(_configs[section_id].get(key, "")))
	if path.is_empty():
		return
	DirAccess.make_dir_recursive_absolute(path)
	OS.shell_show_in_file_manager(path)
	_update_status(section_id)


func _on_reset_pressed() -> void:
	for section in SECTIONS:
		_configs[section.id] = Settings.default_metadata_source(section.id)
		_show_config(section.id)


func _on_save_pressed() -> void:
	for section in SECTIONS:
		settings.set_metadata_source(section.id, _configs[section.id])
	settings.save()
	saved.emit()
	close()


## Shows the home folder as "~" so long paths stay readable. LocalFolderSource
## expands it again.
func _abbreviate_home(path: String) -> String:
	var home := LocalFolderSource.expand_path("~")
	if not home.is_empty() and path.begins_with(home + "/"):
		return "~" + path.substr(home.length())
	return path


func _make_row(label_text: String, control: Control) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var label := Label.new()
	label.text = label_text
	label.custom_minimum_size.x = LABEL_WIDTH
	row.add_child(label)
	row.add_child(control)
	return row


func _make_button(text: String, on_pressed: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.pressed.connect(on_pressed)
	return button
