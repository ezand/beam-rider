class_name MetadataSources
extends RefCounted
## The kinds of MetadataSource, and creating one from its settings.

## Every source type, in the order the settings screen lists them.
## Each script has TYPE, DISPLAY_NAME and FIELDS constants.
static func types() -> Array[GDScript]:
	return [
		LocalFolderSource,
	]


## The source type with id `type`, or null.
static func find_type(type: String) -> GDScript:
	for script in types():
		if script.TYPE == type:
			return script
	return null


## A source for a settings config ({ "type": ..., plus the type's FIELDS }),
## or null if the type is unknown.
static func create(config: Dictionary) -> MetadataSource:
	var script := find_type(str(config.get("type", "")))
	if script == null:
		push_warning("Unknown metadata source type: %s" % config.get("type"))
		return null
	return script.new(config)
