class_name ArtLoader
extends Node
## Loads card art from a MetadataSource on worker threads and keeps recent
## results (including "no art") in a small LRU cache of textures.
##
## request() never blocks: it returns the cached texture, or null and queues a
## load. art_loaded fires when the texture arrives, so the card can be re-bound.
## Only the newest requests are kept, so fast scrolling past thousands of games
## never builds a backlog: whatever is on screen now loads first.

signal art_loaded(key: String)

## Tried in this order for each key.
const EXTENSIONS: PackedStringArray = ["png", "jpg", "jpeg", "webp"]

## Larger images are scaled down to this many pixels on their longest side.
@export var max_size := 512
## Keys remembered, with or without art.
@export var cache_size := 160
## Queued requests beyond this are dropped, oldest first.
@export var max_queued := 24
@export var max_running := 2

## Where art comes from. null = no art. Setting it clears the cache.
var source: MetadataSource: set = set_source

## key -> Texture2D, or null when the source has no art for it. Kept in use order.
var _cache := {}
## Keys waiting to load, newest last.
var _queue: Array[String] = []
## WorkerThreadPool task id -> Job.
var _running := {}
## Bumped when the source changes, so loads for the old source are discarded.
var _generation := 0


class Job:
	var key: String
	var generation: int
	var image: Image


func set_source(value: MetadataSource) -> void:
	source = value
	_generation += 1
	_cache.clear()
	_queue.clear()


## The texture for `key` (a path without extension, like "NES/Metroid"), or null
## if it isn't loaded yet or there is none. Watch art_loaded for the former.
func request(key: String) -> Texture2D:
	if source == null:
		return null
	if _cache.has(key):
		var texture: Texture2D = _cache[key]
		_cache.erase(key)
		_cache[key] = texture
		return texture
	_queue.erase(key)
	_queue.append(key)
	if _queue.size() > max_queued:
		_queue.pop_front()
	return null


## Drops `key` from the cache, so the next request loads it again. Use it when
## the art has changed, such as after scraping.
func forget(key: String) -> void:
	_cache.erase(key)


func _process(_delta: float) -> void:
	for task_id in _running.keys():
		if WorkerThreadPool.is_task_completed(task_id):
			WorkerThreadPool.wait_for_task_completion(task_id)
			_finish(_running[task_id])
			_running.erase(task_id)
	while _running.size() < max_running and not _queue.is_empty():
		_start(_queue.pop_back())


func _start(key: String) -> void:
	for job: Job in _running.values():
		if job.key == key and job.generation == _generation:
			return
	var job := Job.new()
	job.key = key
	job.generation = _generation
	var job_source := source
	var job_max_size := max_size
	var task_id := WorkerThreadPool.add_task(func() -> void:
			job.image = _decode(job_source.read_first(key, EXTENSIONS), job_max_size),
			false, "Load art")
	_running[task_id] = job


func _finish(job: Job) -> void:
	if job.generation != _generation:
		return
	var texture: Texture2D = ImageTexture.create_from_image(job.image) if job.image else null
	_cache[job.key] = texture
	if _cache.size() > cache_size:
		_cache.erase(_cache.keys()[0])
	if texture:
		art_loaded.emit(job.key)


## Runs on a worker thread. `file` is a MetadataSource.read_first() result.
static func _decode(file: Dictionary, size_limit: int) -> Image:
	if file.is_empty():
		return null
	var data: PackedByteArray = file["data"]
	var image := Image.new()
	var error := ERR_FILE_UNRECOGNIZED
	match String(file["path"]).get_extension().to_lower():
		"png":
			error = image.load_png_from_buffer(data)
		"jpg", "jpeg":
			error = image.load_jpg_from_buffer(data)
		"webp":
			error = image.load_webp_from_buffer(data)
	if error != OK:
		push_warning("Could not decode art %s (error %d)" % [file["path"], error])
		return null
	var longest := maxi(image.get_width(), image.get_height())
	if longest > size_limit:
		var factor := float(size_limit) / longest
		image.resize(maxi(1, roundi(image.get_width() * factor)),
				maxi(1, roundi(image.get_height() * factor)), Image.INTERPOLATE_LANCZOS)
	image.generate_mipmaps()
	return image


func _exit_tree() -> void:
	for task_id in _running:
		WorkerThreadPool.wait_for_task_completion(task_id)
	_running.clear()
