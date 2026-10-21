extends SceneTree
## Scrapes the library with the scraper in user://settings.cfg, saving art into
## the configured metadata folders. Same as "Scrape library" in Settings.
##
## godot --headless --path . --script res://tools/scrape_library.gd -- [--all] [--db=user://library.db]


func _init() -> void:
	var path := "user://library.db"
	var only_unscraped := true
	for arg in OS.get_cmdline_user_args():
		if arg == "--all":
			only_unscraped = false
		elif arg.begins_with("--db="):
			path = arg.get_slice("=", 1)
	var settings := Settings.new()
	settings.load_file()
	var scraper := Scrapers.create(settings.get_config(Settings.SCRAPER))
	if scraper == null:
		quit(1)
		return
	var job := ScrapeJob.new(path, scraper,
			MetadataSources.create(settings.get_config(Settings.PLATFORM_METADATA)),
			MetadataSources.create(settings.get_config(Settings.GAME_METADATA)))
	job.only_unscraped = only_unscraped
	job.on_event = func(event: Dictionary) -> void:
		match event.type:
			"progress":
				print("[%d/%d] %s" % [event.done + 1, event.total, event.text])
			"art":
				print("  saved %s art: %s" % [event.scope, event.key])
	var summary := job.run()
	print("%d found, %d not found, %d failed. %s" % [
			summary.found, summary.not_found, summary.failed, summary.message])
	quit(1 if summary.stopped and summary.message != "Stopped." else 0)
