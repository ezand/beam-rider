class_name Spinner
extends Node3D
## A ring of items that spins around the Y axis.
## The selected item always comes to rest at this node's origin, facing +Z.

signal selection_changed(index: int)

@export var item_size := Vector3(1.6, 1.0, 0.2)
## Arc length between neighbouring items. Sets the ring radius with min_radius.
@export var item_spacing := 2.0
@export var min_radius := 2.5
@export var spin_smoothing := 10.0
@export var selected_scale := 1.3
@export var idle_emission := 0.15
@export var selected_emission := 0.9
## 0 = items face straight out from the ring, 1 = every item faces the camera.
@export_range(0.0, 1.0) var face_camera := 0.6

var items: Array = []
var selected := 0

var _ring: Node3D
var _nodes: Array[Node3D] = []
var _materials: Array[StandardMaterial3D] = []
var _angles: Array[float] = []
var _step := 0.0
var _target_angle := 0.0


func _ready() -> void:
	_ring = Node3D.new()
	_ring.name = "Ring"
	add_child(_ring)


## Replaces the ring's contents. Each item is a Dictionary with
## "name", optional "subtitle", and "color" (a Color or hex string).
func set_items(new_items: Array, start_index := 0) -> void:
	for node in _nodes:
		node.queue_free()
	_nodes.clear()
	_materials.clear()
	_angles.clear()
	items = new_items

	var count := items.size()
	if count == 0:
		return
	_step = TAU / count
	var radius := maxf(min_radius, item_spacing * count / TAU)
	_ring.position = Vector3(0, 0, -radius)

	for i in count:
		var angle := i * _step
		var node := _build_item(items[i])
		node.position = Vector3(sin(angle), 0, cos(angle)) * radius
		node.rotation.y = angle
		_ring.add_child(node)
		_nodes.append(node)
		_angles.append(angle)

	selected = clampi(start_index, 0, count - 1)
	_target_angle = -selected * _step
	_ring.rotation.y = _target_angle
	selection_changed.emit(selected)


## Moves the selection by `direction` steps (+1 = right, -1 = left), wrapping.
func move(direction: int) -> void:
	if items.size() < 2:
		return
	selected = posmod(selected + direction, items.size())
	_target_angle -= direction * _step
	selection_changed.emit(selected)


func _process(delta: float) -> void:
	var weight := 1.0 - exp(-spin_smoothing * delta)
	_ring.rotation.y = lerpf(_ring.rotation.y, _target_angle, weight)
	for i in _nodes.size():
		# Turn each item partly toward the camera so side items aren't seen edge-on.
		var relative := wrapf(_angles[i] + _ring.rotation.y, -PI, PI)
		_nodes[i].rotation.y = _angles[i] - relative * face_camera
		var is_selected := i == selected
		var target_scale := selected_scale if is_selected else 1.0
		_nodes[i].scale = _nodes[i].scale.lerp(Vector3.ONE * target_scale, weight)
		var target_emission := selected_emission if is_selected else idle_emission
		_materials[i].emission_energy_multiplier = lerpf(
				_materials[i].emission_energy_multiplier, target_emission, weight)


func _build_item(data: Dictionary) -> Node3D:
	var color: Color = data.get("color", Color.WHITE)
	if data.get("color") is String:
		color = Color(data["color"])

	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.metallic = 0.3
	material.roughness = 0.35
	material.emission_enabled = true
	material.emission = color
	material.emission_energy_multiplier = idle_emission
	_materials.append(material)

	var mesh := BoxMesh.new()
	mesh.size = item_size
	var body := MeshInstance3D.new()
	body.mesh = mesh
	body.material_override = material

	var front := item_size.z / 2.0 + 0.01
	# Scale text with the item's width so narrow items don't break words apart.
	var text_scale := minf(1.0, item_size.x / 1.6)
	var title := _make_label(data.get("name", "?"), roundi(64 * text_scale))
	title.position = Vector3(0, item_size.y * 0.1, front)
	title.width = item_size.x / title.pixel_size * 0.9
	body.add_child(title)

	var subtitle_text: String = str(data.get("subtitle", ""))
	if not subtitle_text.is_empty():
		var subtitle := _make_label(subtitle_text, roundi(36 * maxf(text_scale, 0.8)))
		subtitle.position = Vector3(0, -item_size.y * 0.5 + 0.14, front)
		subtitle.modulate = Color(1, 1, 1, 0.75)
		body.add_child(subtitle)

	return body


func _make_label(text: String, font_size: int) -> Label3D:
	var label := Label3D.new()
	label.text = text
	label.font_size = font_size
	label.pixel_size = 0.004
	label.outline_size = 5
	label.outline_modulate = Color(0, 0, 0, 0.6)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.double_sided = false
	return label
