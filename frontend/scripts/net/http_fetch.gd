class_name HttpFetch
extends RefCounted
## Blocking HTTP GET for worker threads (HTTPRequest needs the scene tree and
## the main thread). Follows a few redirects.

const MAX_REDIRECTS := 4
const USER_AGENT := "BeamRider"


## Fetches `url`. Returns { "status": int (0 on network failure), "body":
## PackedByteArray, "headers": Dictionary (lowercase names), "error": String }.
static func fetch(url: String, timeout_sec := 30.0) -> Dictionary:
	for _redirect in MAX_REDIRECTS + 1:
		var response := _request(url, timeout_sec)
		var location: String = response.headers.get("location", "")
		if response.status in [301, 302, 303, 307, 308] and not location.is_empty():
			url = _resolve(url, location)
			continue
		return response
	return _failure("Too many redirects")


static func _request(url: String, timeout_sec: float) -> Dictionary:
	var parts := _split_url(url)
	if parts.is_empty():
		return _failure("Invalid URL: %s" % url)
	var client := HTTPClient.new()
	var tls: TLSOptions = TLSOptions.client() if parts.https else null
	if client.connect_to_host(parts.host, parts.port, tls) != OK:
		return _failure("Could not connect to %s" % parts.host)
	var deadline := Time.get_ticks_msec() + int(timeout_sec * 1000)

	while client.get_status() in [HTTPClient.STATUS_RESOLVING, HTTPClient.STATUS_CONNECTING]:
		if not _wait(client, deadline):
			return _failure("Timed out connecting to %s" % parts.host)
	if client.get_status() != HTTPClient.STATUS_CONNECTED:
		return _failure("Could not connect to %s" % parts.host)

	var headers := PackedStringArray(["User-Agent: " + USER_AGENT, "Accept: */*"])
	if client.request(HTTPClient.METHOD_GET, parts.path, headers) != OK:
		return _failure("Request failed")
	while client.get_status() == HTTPClient.STATUS_REQUESTING:
		if not _wait(client, deadline):
			return _failure("Timed out waiting for %s" % parts.host)
	if not client.has_response():
		return _failure("No response from %s" % parts.host)

	var body := PackedByteArray()
	while client.get_status() == HTTPClient.STATUS_BODY:
		var chunk := client.read_response_body_chunk()
		if chunk.is_empty():
			if not _wait(client, deadline):
				return _failure("Timed out reading from %s" % parts.host)
		else:
			body.append_array(chunk)
	var response_headers := {}
	var raw_headers := client.get_response_headers_as_dictionary()
	for name: String in raw_headers:
		response_headers[name.to_lower()] = raw_headers[name]
	var result := { "status": client.get_response_code(), "body": body,
			"headers": response_headers, "error": "" }
	client.close()
	return result


static func _wait(client: HTTPClient, deadline: int) -> bool:
	client.poll()
	if Time.get_ticks_msec() > deadline:
		return false
	OS.delay_msec(5)
	return true


## { https, host, port, path } or {} if `url` isn't http(s).
static func _split_url(url: String) -> Dictionary:
	var https := url.begins_with("https://")
	if not https and not url.begins_with("http://"):
		return {}
	var rest := url.substr(8 if https else 7)
	var slash := rest.find("/")
	var authority := rest if slash == -1 else rest.substr(0, slash)
	var path := "/" if slash == -1 else rest.substr(slash)
	var port := 443 if https else 80
	var colon := authority.rfind(":")
	if colon != -1:
		port = int(authority.substr(colon + 1))
		authority = authority.substr(0, colon)
	return { "https": https, "host": authority, "port": port, "path": path }


static func _resolve(base: String, location: String) -> String:
	if location.begins_with("http://") or location.begins_with("https://"):
		return location
	var parts := _split_url(base)
	var origin := "%s://%s:%d" % ["https" if parts.https else "http", parts.host, parts.port]
	if location.begins_with("/"):
		return origin + location
	return origin + parts.path.get_base_dir().path_join(location)


static func _failure(message: String) -> Dictionary:
	return { "status": 0, "body": PackedByteArray(), "headers": {}, "error": message }


## Encodes a query string from a Dictionary, skipping empty values.
static func query(params: Dictionary) -> String:
	var parts := PackedStringArray()
	for key in params:
		var value := str(params[key])
		if not value.is_empty():
			parts.append("%s=%s" % [key, value.uri_encode()])
	return "&".join(parts)
