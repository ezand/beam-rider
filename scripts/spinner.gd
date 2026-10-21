class_name Spinner
extends Node3D
## A virtualized carousel. Items sit on an arc that turns around a vertical axis
## behind the selected item, which always rests at this node's origin facing +Z.
##
## Only the items near the front exist as nodes. They are recycled as the wheel
## turns, so the cost per frame stays the same whether the list has 10 or 100,000
## entries. Item data is pulled on demand from a provider callable.

signal selection_changed(index: int)

@export var item_size := Vector3(1.6, 1.0, 0.2): set = _set_item_size
## Arc length between neighbouring items.
@export var item_spacing := 2.0
@export var radius := 4.0
## Items further round the wheel than this are not drawn.
@export_range(30.0, 180.0) var max_angle_degrees := 105.0
## Hard cap on the number of items drawn either side of the selection.
@export var max_side_items := 8
@export var spin_smoothing := 12.0
## How many items the animation may trail behind the selection. Keeps the front
## card in step with the selection during fast scrolling and big jumps.
@export var max_scroll_lag := 2.0
@export var selected_scale := 1.3
@export var idle_emission := 0.15
@export var selected_emission := 0.9
## 0 = items face straight out from the wheel, 1 = every item faces the camera.
@export_range(0.0, 1.0) var face_camera := 0.6

var item_count := 0
var selected := 0
## Time the last _process took, in microseconds. For the debug overlay.
var last_update_usec := 0
## Total items bound to a slot since start. For the debug overlay.
var total_binds := 0

var _provider: Callable
## Scroll position and target, in items. Not wrapped, so animation never jumps.
var _position := 0.0
var _target := 0
## Unwrapped item index -> Slot currently showing it.
var _active := {}
var _pool: Array[Slot] = []
var _mesh := BoxMesh.new()


class Slot:
	var root: MeshInstance3D
	var material: StandardMaterial3D
	var title: Label3D
	var subtitle: Label3D


## Convenience wrapper for a list that is already in memory.
func set_items(items: Array, start_index := 0) -> void:
	set_source(items.size(), func(i: int) -> Dictionary: return items[i], start_index)


## Shows `count` items. `provider(index) -> Dictionary` is called only for items
## about to become visible and must return `name`, optional `subtitle`, and
## `color` (a Color or hex string).
func set_source(count: int, provider: Callable, start_index := 0) -> void:
	for index in _active.keys():
		_release(index)
	item_count = count
	_provider = provider
	if count == 0:
		return
	selected = clampi(start_index, 0, count - 1)
	_target = selected
	_position = selected
	_sync_slots()
	_update_transforms()
	selection_changed.emit(selected)


## Moves the selection by `steps` (+ = right, - = left), wrapping around.
func move(steps: int) -> void:
	if item_count < 2 or steps == 0:
		return
	_target += steps
	selected = posmod(_target, item_count)
	# On big jumps or very fast scrolling, skip the animation ahead so only a
	# few items are ever in flight instead of rebuilding every item in between.
	if absf(_target - _position) > max_scroll_lag:
		_position = _target - signf(_target - _position) * max_scroll_lag
	selection_changed.emit(selected)


func jump_to(index: int) -> void:
	move(clampi(index, 0, item_count - 1) - selected)


func _process(delta: float) -> void:
	if item_count == 0:
		return
	var started := Time.get_ticks_usec()
	_position = lerpf(_position, _target, 1.0 - exp(-spin_smoothing * delta))
	if absf(_target - _position) < 0.001:
		_position = _target
	_sync_slots()
	_update_transforms()
	last_update_usec = Time.get_ticks_usec() - started


func _angle_step() -> float:
	return item_spacing / radius


func _side_count() -> int:
	var by_angle := floori(deg_to_rad(max_angle_degrees) / _angle_step())
	return clampi(by_angle, 0, max_side_items)


## Makes sure exactly the items in the visible window have slots.
func _sync_slots() -> void:
	var visible_count := mini(_side_count() * 2 + 1, item_count)
	var left := floori((visible_count - 1) / 2.0)
	var first := roundi(_position) - left
	var last := first + visible_count - 1
	for index in _active.keys():
		if index < first or index > last:
			_release(index)
	for index in range(first, last + 1):
		if not _active.has(index):
			var slot := _take_slot()
			_bind(slot, posmod(index, item_count))
			_active[index] = slot


func _update_transforms() -> void:
	var step := _angle_step()
	var max_angle := deg_to_rad(max_angle_degrees)
	var fade_angle := deg_to_rad(20.0)
	for index in _active:
		var slot: Slot = _active[index]
		var offset: float = index - _position
		var angle := offset * step
		slot.root.position = Vector3(sin(angle) * radius, 0.0, (cos(angle) - 1.0) * radius)
		slot.root.rotation.y = angle * (1.0 - face_camera)
		var focus := clampf(1.0 - absf(offset), 0.0, 1.0)
		var edge := clampf((max_angle - absf(angle)) / fade_angle, 0.0, 1.0)
		var item_scale := lerpf(1.0, selected_scale, focus) * edge
		slot.root.scale = Vector3.ONE * maxf(item_scale, 0.001)
		slot.material.emission_energy_multiplier = lerpf(idle_emission, selected_emission, focus)


func _take_slot() -> Slot:
	var slot: Slot = _pool.pop_back() if not _pool.is_empty() else _create_slot()
	slot.root.visible = true
	return slot


func _release(index: int) -> void:
	var slot: Slot = _active[index]
	slot.root.visible = false
	_active.erase(index)
	_pool.append(slot)


func _bind(slot: Slot, index: int) -> void:
	total_binds += 1
	var data: Dictionary = _provider.call(index)
	var color: Variant = data.get("color", Color.WHITE)
	if color is String:
		color = Color(color)
	slot.material.albedo_color = color
	slot.material.emission = color
	slot.title.text = data.get("name", "?")
	var subtitle_text := str(data.get("subtitle", ""))
	slot.subtitle.text = subtitle_text
	slot.subtitle.visible = not subtitle_text.is_empty()


func _create_slot() -> Slot:
	var slot := Slot.new()
	slot.material = StandardMaterial3D.new()
	slot.material.metallic = 0.3
	slot.material.roughness = 0.35
	slot.material.emission_enabled = true

	slot.root = MeshInstance3D.new()
	slot.root.mesh = _mesh
	slot.root.material_override = slot.material
	slot.title = _make_label()
	slot.subtitle = _make_label()
	slot.subtitle.modulate = Color(1, 1, 1, 0.75)
	slot.root.add_child(slot.title)
	slot.root.add_child(slot.subtitle)
	add_child(slot.root)
	_layout_slot(slot)
	return slot


## Sizes and places a slot's labels to fit `item_size`.
func _layout_slot(slot: Slot) -> void:
	var front := item_size.z / 2.0 + 0.01
	# Scale text with the item's width so narrow items don't break words apart.
	var text_scale := minf(1.0, item_size.x / 1.6)
	slot.title.font_size = roundi(64 * text_scale)
	slot.title.position = Vector3(0, item_size.y * 0.1, front)
	slot.title.width = item_size.x / slot.title.pixel_size * 0.9
	slot.subtitle.font_size = roundi(36 * maxf(text_scale, 0.8))
	slot.subtitle.position = Vector3(0, -item_size.y * 0.5 + 0.14, front)
	slot.subtitle.width = slot.title.width


func _set_item_size(value: Vector3) -> void:
	item_size = value
	_mesh.size = value
	for slot in _pool:
		_layout_slot(slot)
	for slot in _active.values():
		_layout_slot(slot)


func _make_label() -> Label3D:
	var label := Label3D.new()
	label.pixel_size = 0.004
	label.outline_size = 5
	label.outline_modulate = Color(0, 0, 0, 0.6)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.double_sided = false
	return label
