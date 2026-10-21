class_name Scrapers
extends RefCounted
## The kinds of Scraper, and creating one from its settings.


## Every provider, in the order the settings screen lists them.
## Each script has TYPE, DISPLAY_NAME and FIELDS constants.
static func types() -> Array[GDScript]:
	return [
		ScreenScraper,
	]


## The provider with id `type`, or null.
static func find_type(type: String) -> GDScript:
	for script in types():
		if script.TYPE == type:
			return script
	return null


## A scraper for a settings config ({ "type": ..., plus the type's fields }),
## or null if the type is unknown.
static func create(config: Dictionary) -> Scraper:
	var script := find_type(str(config.get("type", "")))
	if script == null:
		push_warning("Unknown scraper type: %s" % config.get("type"))
		return null
	return script.new(config)


## All fields a provider's settings have: its own, then the common ones.
static func fields_of(script: GDScript) -> Array:
	return script.FIELDS + Scraper.COMMON_FIELDS
