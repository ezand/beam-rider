class_name DetailsPanel
extends PanelContainer
## Art and information for the selected item, shown beside the spinner once
## the wheel stops. Built in code. Anything missing (art, description, facts)
## is simply left out, so an unscraped game shows just its name and year.

const ACCENT := Color(0.55, 0.85, 1.0)
const DIM_TEXT := Color(1, 1, 1, 0.55)
const FADE_IN := 0.2
const FADE_OUT := 0.08

var _style := StyleBoxFlat.new()
var _content: VBoxContainer
var _art: TextureRect
var _title: Label
var _subtitle: Label
var _facts: GridContainer
var _description: Label
var _tween: Tween


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_style.bg_color = Color(0.02, 0.02, 0.05, 0.72)
	_style.border_color = ACCENT
	_style.border_width_top = 3
	_style.set_corner_radius_all(12)
	_style.set_content_margin_all(20)
	# Leaves room for the scrape status, which sits over the panel's bottom edge.
	_style.content_margin_bottom = 44
	add_theme_stylebox_override("panel", _style)

	_content = VBoxContainer.new()
	_content.add_theme_constant_override("separation", 10)
	_content.modulate.a = 0.0
	add_child(_content)

	_art = TextureRect.new()
	_art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_art.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_art.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_art.size_flags_stretch_ratio = 1.3
	_content.add_child(_art)

	_title = _make_label(28, Color.WHITE)
	_content.add_child(_title)
	_subtitle = _make_label(18, ACCENT)
	_content.add_child(_subtitle)

	_facts = GridContainer.new()
	_facts.columns = 2
	_facts.add_theme_constant_override("h_separation", 16)
	_facts.add_theme_constant_override("v_separation", 4)
	_content.add_child(_facts)

	_description = _make_label(16, Color(1, 1, 1, 0.8))
	_description.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_description.clip_text = true
	_description.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_content.add_child(_description)


## Shows an item and fades it in. `item` has `name`, optional `subtitle`,
## `color` (accent line), `art` (Texture2D), `facts` (Array of [label, value])
## and `description`.
func show_item(item: Dictionary) -> void:
	var color: Variant = item.get("color", ACCENT)
	_style.border_color = Color(color) if color is String else color
	_title.text = item.get("name", "")
	_subtitle.text = item.get("subtitle", "")
	_subtitle.visible = not _subtitle.text.is_empty()
	for child in _facts.get_children():
		child.queue_free()
	for fact: Array in item.get("facts", []):
		_facts.add_child(_make_label(16, DIM_TEXT, str(fact[0]), false))
		_facts.add_child(_make_label(16, Color.WHITE, str(fact[1])))
	_facts.visible = not item.get("facts", []).is_empty()
	_description.text = item.get("description", "")
	_description.visible = not _description.text.is_empty()
	set_art(item.get("art"))
	_fade(1.0, FADE_IN)


## Replaces the art of the item on show, e.g. when it finishes loading.
func set_art(texture: Texture2D) -> void:
	_art.texture = texture
	_art.visible = texture != null


## Fades the content out, leaving the empty panel.
func clear() -> void:
	_fade(0.0, FADE_OUT)


func _fade(alpha: float, duration: float) -> void:
	if _tween:
		_tween.kill()
	_tween = create_tween()
	_tween.tween_property(_content, "modulate:a", alpha, duration)


func _make_label(font_size: int, color: Color, text := "", wrap := true) -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	if wrap:
		label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return label
