class_name LibraryScraper
extends Node
## Runs a ScrapeJob on a worker thread and re-emits its events as signals on
## the main thread. One job at a time.

signal progress(done: int, total: int, text: String)
## Art was saved for a platform or game. `key` is its ArtLoader key.
signal art_saved(scope: String, key: String)
## { found, not_found, failed, stopped, message }
signal finished(summary: Dictionary)

var _job: ScrapeJob
var _task_id := -1


func is_running() -> bool:
	return _job != null


## Starts `job` unless one is already running. Returns whether it started.
func start(job: ScrapeJob) -> bool:
	if is_running():
		return false
	_job = job
	_job.on_event = func(event: Dictionary) -> void: _on_job_event.call_deferred(event)
	_task_id = WorkerThreadPool.add_task(_job.run, true, "Scrape library")
	return true


## Stops after the current item; finished fires when it has.
func cancel() -> void:
	if _job:
		_job.cancel()


func _on_job_event(event: Dictionary) -> void:
	match event.type:
		"progress":
			progress.emit(event.done, event.total, event.text)
		"art":
			art_saved.emit(event.scope, event.key)
		"finished":
			WorkerThreadPool.wait_for_task_completion(_task_id)
			_job = null
			_task_id = -1
			finished.emit(event)


func _exit_tree() -> void:
	if _job:
		_job.cancel()
		WorkerThreadPool.wait_for_task_completion(_task_id)
