class_name GameLibrary
extends RefCounted
## Read access to the game library database (SQLite via the godot-sqlite addon).
##
## Query once per view (a platform, a filter, a search) and keep the result in
## memory for the spinner. Don't query per card while scrolling: converting rows
## to Dictionaries is the expensive part, not the lookup.

## Bump when the schema changes. A database with another version is rebuilt
## (while the data is generated placeholder data, see LibraryBuilder).
const SCHEMA_VERSION := 2

const SCHEMA: Array[String] = [
	# `key` is the platform's short id, as in RetroPie folder names ("nes",
	# "megadrive"). Scrapers map it to their own platform ids.
	"""CREATE TABLE platforms (
		id INTEGER PRIMARY KEY,
		key TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		maker TEXT,
		year INTEGER,
		color TEXT,
		sort_order INTEGER NOT NULL DEFAULT 0
	)""",
	"""CREATE TABLE games (
		id INTEGER PRIMARY KEY,
		platform_id INTEGER NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		sort_name TEXT NOT NULL,
		year INTEGER,
		file TEXT,
		description TEXT,
		developer TEXT,
		publisher TEXT,
		genre TEXT,
		players TEXT,
		rating REAL,
		scraped_at INTEGER,
		scrape_status TEXT
	)""",
	"CREATE INDEX games_by_platform_sort_name ON games(platform_id, sort_name)",
	"PRAGMA user_version = %d" % SCHEMA_VERSION,
]

## Duration of the last query including row conversion, in milliseconds.
var last_query_msec := 0.0

var _db: SQLite


func open(path: String, read_only := false) -> bool:
	_db = SQLite.new()
	_db.path = path
	_db.read_only = read_only
	_db.foreign_keys = true
	_db.verbosity_level = SQLite.QUIET
	if not _db.open_db():
		push_error("Could not open library database %s: %s" % [path, _db.error_message])
		_db = null
		return false
	# WAL lets the scraper write on its own connection while the UI reads.
	_db.query("PRAGMA busy_timeout = 5000")
	if not read_only:
		_db.query("PRAGMA journal_mode = WAL")
	return true


func close() -> void:
	if _db:
		_db.close_db()
		_db = null


func schema_version() -> int:
	var rows := _select("PRAGMA user_version")
	return int(rows[0]["user_version"]) if not rows.is_empty() else 0


## All platforms in display order, each with a `game_count`.
func get_platforms() -> Array:
	return _select("""
		SELECT p.id, p.key, p.name, p.maker, p.year, p.color, COUNT(g.id) AS game_count
		FROM platforms p
		LEFT JOIN games g ON g.platform_id = p.id
		GROUP BY p.id
		ORDER BY p.sort_order, p.name""")


## The list the spinner needs for one platform, sorted by `sort_name`.
## Keep these columns minimal; fetch details with get_game() for the selection.
func get_games(platform_id: int) -> Array:
	return _select("""
		SELECT id, name, sort_name, year
		FROM games
		WHERE platform_id = ?
		ORDER BY sort_name""", [platform_id])


func get_game(game_id: int) -> Dictionary:
	var rows := _select("SELECT * FROM games WHERE id = ?", [game_id])
	return rows[0] if not rows.is_empty() else {}


## Games of a platform for a scraper: all of them, or only those never scraped.
func get_games_to_scrape(platform_id: int, only_unscraped := true) -> Array:
	return _select("""
		SELECT id, name, file, year
		FROM games
		WHERE platform_id = ?%s
		ORDER BY sort_name""" % (" AND scraped_at IS NULL" if only_unscraped else ""),
		[platform_id])


## Records a scrape of a game. `status` is "found", "not_found" or "error".
## Metadata keys as in Scraper.Result; `year` only fills in a missing year.
func save_scrape(game_id: int, status: String, metadata := {}) -> bool:
	var columns := ["scraped_at = ?", "scrape_status = ?"]
	var values: Array = [int(Time.get_unix_time_from_system()), status]
	for key in ["description", "developer", "publisher", "genre", "players", "rating"]:
		if metadata.has(key):
			columns.append("%s = ?" % key)
			values.append(metadata[key])
	if int(metadata.get("year", 0)) > 0:
		columns.append("year = CASE WHEN year IS NULL OR year = 0 THEN ? ELSE year END")
		values.append(int(metadata.year))
	values.append(game_id)
	return execute("UPDATE games SET %s WHERE id = ?" % ", ".join(columns), values)


## Runs a statement that returns no rows. Used by LibraryBuilder.
func execute(sql: String, bindings: Array = []) -> bool:
	var ok := _db.query_with_bindings(sql, bindings) if not bindings.is_empty() else _db.query(sql)
	if not ok:
		push_error("SQL failed: %s\n%s" % [_db.error_message, sql])
	return ok


func insert_rows(table: String, rows: Array) -> bool:
	var ok := _db.insert_rows(table, rows)
	if not ok:
		push_error("Insert into %s failed: %s" % [table, _db.error_message])
	return ok


func _select(sql: String, bindings: Array = []) -> Array:
	if _db == null:
		push_error("Library database is not open")
		return []
	var started := Time.get_ticks_usec()
	var ok := _db.query_with_bindings(sql, bindings) if not bindings.is_empty() else _db.query(sql)
	var rows: Array = _db.query_result if ok else []
	last_query_msec = (Time.get_ticks_usec() - started) / 1000.0
	if not ok:
		push_error("SQL failed: %s\n%s" % [_db.error_message, sql])
	return rows


## Lowercased, with a leading article moved out of the way, so
## "The Legend of Zelda" sorts and letter-jumps under L.
static func make_sort_name(name: String) -> String:
	var lower := name.strip_edges().to_lower()
	for article in ["the ", "a ", "an "]:
		if lower.begins_with(article) and lower.length() > article.length():
			return lower.substr(article.length())
	return lower
