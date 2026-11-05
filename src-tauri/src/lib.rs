use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde_json::{json, Map, Value};
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::State;

const PRESENSI_SERVICE_URL: &str = "https://presensi.bkd.jatimprov.go.id/service";
const EPRESENSI_ORIGIN: &str = "https://presensi.bkd.jatimprov.go.id";
const PRESENSI_VERSION: u64 = 89;

#[derive(Default)]
struct WebPresensiSession {
    cookies: Mutex<HashMap<String, String>>,
}

fn build_rpc_envelope(object: &str, mut param: Value) -> Result<Value, String> {
    if !valid_rpc_object(object) {
        return Err("Nama RPC tidak valid.".into());
    }

    if !param.is_object() {
        param = Value::Object(Map::new());
    }
    let params = param
        .as_object_mut()
        .ok_or_else(|| "Parameter RPC tidak valid.".to_string())?;
    let api_key = params.get("api_key").cloned().unwrap_or_else(|| json!(""));
    let last_latlong = params
        .get("last_latlong")
        .cloned()
        .unwrap_or_else(|| json!(""));
    let imei = params
        .get("imei")
        .and_then(Value::as_str)
        .map(|value| json!(value))
        .unwrap_or_else(|| json!(""));
    params.insert("api_key".into(), api_key);
    params.insert("last_latlong".into(), last_latlong);
    params.insert("imei".into(), imei);

    Ok(json!({
        "jsonrpc": 2,
        "method": "POST",
        "version": PRESENSI_VERSION,
        "object": object,
        "param": Value::Object(params.clone())
    }))
}

fn valid_rpc_object(object: &str) -> bool {
    (2..=40).contains(&object.len())
        && object
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn rpc_response(status: u16, text: &str) -> (u16, String) {
    let parsed = match serde_json::from_str::<Value>(text) {
        Ok(value) => value,
        Err(_) => {
            let status = if status >= 500 { 503 } else { 502 };
            return (
                status,
                json!({
                    "error": "Server pusat mengirim respons dengan format tidak valid.",
                    "huluStatus": status
                })
                .to_string(),
            );
        }
    };

    let upstream_error = parsed.get("error");
    let mut response = json!({
        "jsonrpc": parsed.get("jsonrpc").cloned().unwrap_or(json!(2)),
        "id_req": parsed.get("id_req").cloned().unwrap_or(json!("")),
        "result": parsed.get("result").cloned().unwrap_or(Value::Null),
        "total": parsed.get("total"),
        "page": parsed.get("page"),
        "view": parsed.get("view")
    });
    if let Some(error) = upstream_error.filter(|value| !value.is_null()) {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .or_else(|| error.as_str())
            .unwrap_or("Permintaan ditolak server pusat.");
        let code = error.get("code").cloned().unwrap_or(Value::Null);
        response["error"] = json!(message);
        if !code.is_null() {
            response["errorCode"] = code;
        }
    }
    (200, response.to_string())
}

#[tauri::command]
async fn presensi_rpc(object: String, param: Value) -> Result<Value, String> {
    let envelope = build_rpc_envelope(&object, param)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|error| format!("Gagal menyiapkan koneksi server presensi: {error}"))?;
    let response = client
        .post(PRESENSI_SERVICE_URL)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/json; charset=UTF-8",
        )
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::USER_AGENT, "okhttp/4.12.0")
        .json(&envelope)
        .send()
        .await
        .map_err(|error| format!("Gagal menghubungi server pusat: {error}"))?;
    let status = response.status().as_u16();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Gagal membaca respons server pusat: {error}"))?;
    let (status, body) = rpc_response(status, &text);
    Ok(json!({ "status": status, "body": body }))
}

#[tauri::command(rename_all = "camelCase")]
async fn presensi_upload(
    path: String,
    fields: std::collections::HashMap<String, String>,
    file_name: String,
    mime_type: String,
    base64_data: String,
) -> Result<Value, String> {
    if path != "/importfile" {
        return Err("Path unggah tidak diizinkan.".into());
    }
    if base64_data.len() > 6_666_668 {
        return Err("Ukuran lampiran melebihi batas 5 MB.".into());
    }
    let bytes = BASE64
        .decode(base64_data)
        .map_err(|_| "Data lampiran tidak valid.".to_string())?;
    if bytes.len() > 5_000_000 {
        return Err("Ukuran lampiran melebihi batas 5 MB.".into());
    }

    if mime_type.contains('\r') || mime_type.contains('\n') {
        return Err("Tipe lampiran tidak valid.".into());
    }
    let safe_file_name = file_name
        .replace('\r', "_")
        .replace('\n', "_")
        .replace('"', "_")
        .replace('\\', "_");
    let boundary = format!(
        "----Prabawa{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| format!("Waktu sistem tidak valid: {error}"))?
            .as_nanos()
    );
    let mut multipart_body = Vec::new();
    for (name, value) in fields {
        if !matches!(name.as_str(), "api_key" | "id" | "last_latlong" | "type") {
            return Err("Field unggahan tidak diizinkan.".into());
        }
        if value.contains('\r') || value.contains('\n') {
            return Err("Nilai field unggahan tidak valid.".into());
        }
        multipart_body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        multipart_body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n")
                .as_bytes(),
        );
    }
    multipart_body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    multipart_body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"image\"; filename=\"{safe_file_name}\"\r\nContent-Type: {mime_type}\r\n\r\n"
        )
        .as_bytes(),
    );
    multipart_body.extend_from_slice(&bytes);
    multipart_body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|error| format!("Gagal menyiapkan koneksi server presensi: {error}"))?;
    let response = client
        .post(format!("{PRESENSI_SERVICE_URL}{path}"))
        .header(
            reqwest::header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={boundary}"),
        )
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::USER_AGENT, "okhttp/4.12.0")
        .body(multipart_body)
        .send()
        .await
        .map_err(|error| format!("Gagal mengunggah lampiran: {error}"))?;
    let status = response.status().as_u16();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Gagal membaca respons unggah: {error}"))?;
    let parsed = serde_json::from_str::<Value>(&text).map_err(|_| {
        format!("Server pusat mengirim respons unggah tidak valid (HTTP {status}).")
    })?;
    Ok(json!({
        "status": 200,
        "body": json!({
            "result": parsed.get("result").cloned().unwrap_or(Value::Null),
            "error": parsed.get("error").cloned().unwrap_or(Value::Null),
            "errorCode": parsed.get("error").and_then(|error| error.get("code")),
            "upstreamStatus": status
        }).to_string()
    }))
}

fn target_web_path(path: &str) -> Result<String, String> {
    let path = path
        .strip_prefix("/ep")
        .ok_or_else(|| "Path Web Presensi tidak valid.".to_string())?;
    let path = if path.is_empty() { "/" } else { path };
    if !path.starts_with('/') || path.starts_with("//") {
        return Err("Path Web Presensi tidak valid.".into());
    }
    let path = path
        .strip_prefix("/p/")
        .map(|tail| format!("/index.php/{tail}"))
        .or_else(|| (path == "/p").then(|| "/index.php".to_string()))
        .unwrap_or_else(|| path.to_string());
    Ok(path)
}

fn redirect_web_path(location: &str, current_url: &reqwest::Url) -> Result<String, String> {
    let resolved = current_url
        .join(location)
        .map_err(|error| format!("Arah ulang Web Presensi tidak valid: {error}"))?;
    let mut path = resolved.path().to_string();
    if path == "/index.php" {
        path = "/p".into();
    } else if let Some(tail) = path.strip_prefix("/index.php/") {
        path = format!("/p/{tail}");
    }
    if let Some(query) = resolved.query() {
        path.push('?');
        path.push_str(query);
    }
    Ok(path)
}

fn simpan_cookie(headers: &reqwest::header::HeaderMap, jar: &mut HashMap<String, String>) {
    for header in headers.get_all(reqwest::header::SET_COOKIE).iter() {
        let Ok(value) = header.to_str() else {
            continue;
        };
        let Some((name, content)) = value
            .split(';')
            .next()
            .and_then(|pair| pair.split_once('='))
        else {
            continue;
        };
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let expired = content.trim().is_empty()
            || value
                .split(';')
                .any(|attribute| attribute.trim().eq_ignore_ascii_case("max-age=0"));
        if expired {
            jar.remove(name);
        } else {
            jar.insert(name.to_string(), content.trim().to_string());
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
async fn web_presensi_request(
    session: State<'_, WebPresensiSession>,
    path: String,
    method: String,
    body: Option<String>,
    content_type: Option<String>,
) -> Result<Value, String> {
    let mut target_path = target_web_path(&path)?;
    let mut method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|error| format!("Metode Web Presensi tidak valid: {error}"))?;
    if !matches!(
        method.as_str(),
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD"
    ) {
        return Err("Metode Web Presensi tidak diizinkan.".into());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Gagal menyiapkan koneksi Web Presensi: {error}"))?;
    let mut body = body;

    for redirect_count in 0..=10 {
        let url = format!("{EPRESENSI_ORIGIN}{target_path}");
        let mut request = client
            .request(method.clone(), &url)
            .header(reqwest::header::ACCEPT, "*/*")
            .header(reqwest::header::REFERER, format!("{EPRESENSI_ORIGIN}/"))
            .header(reqwest::header::ORIGIN, EPRESENSI_ORIGIN);
        if let Some(content_type) = content_type.as_deref() {
            request = request.header(reqwest::header::CONTENT_TYPE, content_type);
        }
        let cookie_header = {
            let jar = session
                .cookies
                .lock()
                .map_err(|_| "Sesi Web Presensi tidak dapat dibaca.".to_string())?;
            jar.iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join("; ")
        };
        if !cookie_header.is_empty() {
            request = request.header(reqwest::header::COOKIE, cookie_header);
        }
        if let Some(value) = body.as_deref() {
            request = request.body(value.to_string());
        }

        let response = request
            .send()
            .await
            .map_err(|error| format!("Gagal menghubungi server e-Presensi: {error}"))?;
        {
            let mut jar = session
                .cookies
                .lock()
                .map_err(|_| "Sesi Web Presensi tidak dapat diperbarui.".to_string())?;
            simpan_cookie(response.headers(), &mut jar);
        }

        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok());
            if let Some(location) = location {
                if redirect_count == 10 {
                    return Err("Terlalu banyak arah ulang dari server e-Presensi.".into());
                }
                target_path = redirect_web_path(location, &response.url())?;
                if response.status() == reqwest::StatusCode::SEE_OTHER
                    || (matches!(
                        response.status(),
                        reqwest::StatusCode::MOVED_PERMANENTLY | reqwest::StatusCode::FOUND
                    ) && method == reqwest::Method::POST)
                {
                    method = reqwest::Method::GET;
                    body = None;
                }
                continue;
            }
        }

        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("Gagal membaca respons e-Presensi: {error}"))?;
        let is_text = content_type.starts_with("text/")
            || content_type.contains("json")
            || content_type.contains("javascript")
            || content_type.contains("xml");
        let result = if is_text {
            json!({ "body": String::from_utf8_lossy(&bytes).into_owned() })
        } else {
            json!({ "bodyBase64": BASE64.encode(&bytes) })
        };
        return Ok(json!({
            "status": status,
            "contentType": content_type,
            "body": result.get("body").cloned().unwrap_or(Value::Null),
            "bodyBase64": result.get("bodyBase64").cloned().unwrap_or(Value::Null)
        }));
    }

    Err("Terlalu banyak arah ulang dari server e-Presensi.".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .manage(WebPresensiSession::default())
        .invoke_handler(tauri::generate_handler![
            presensi_rpc,
            presensi_upload,
            web_presensi_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running PRABAWA");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rpc_envelope_injects_required_fields_and_preserves_input() {
        let envelope = build_rpc_envelope(
            "absen",
            json!({"api_key":"key","last_latlong":"-7,112","imei":"device","checktype":1}),
        )
        .expect("valid envelope");
        assert_eq!(envelope["version"], 89);
        assert_eq!(envelope["param"]["api_key"], "key");
        assert_eq!(envelope["param"]["last_latlong"], "-7,112");
        assert_eq!(envelope["param"]["imei"], "device");
        assert_eq!(envelope["param"]["checktype"], 1);
    }

    #[test]
    fn rpc_envelope_rejects_invalid_object_names() {
        assert!(build_rpc_envelope("../admin", json!({})).is_err());
        assert!(build_rpc_envelope("login", json!({})).is_ok());
    }

    #[test]
    fn upstream_rpc_error_is_normalized_for_frontend() {
        let (status, body) = rpc_response(
            200,
            r#"{"jsonrpc":2,"error":{"code":402,"message":"device bound"}}"#,
        );
        let parsed: Value = serde_json::from_str(&body).expect("json response");
        assert_eq!(status, 200);
        assert_eq!(parsed["error"], "device bound");
        assert_eq!(parsed["errorCode"], 402);
    }

    #[test]
    fn web_presensi_paths_stay_on_the_native_upstream() {
        assert_eq!(
            target_web_path("/ep/p/login").expect("valid web path"),
            "/index.php/login"
        );
        assert_eq!(
            target_web_path("/ep/uploads/file.pdf").expect("valid file path"),
            "/uploads/file.pdf"
        );
        assert!(target_web_path("/api/panel-auth").is_err());
    }

    #[test]
    fn web_presensi_redirects_are_rewritten_to_proxy_paths() {
        let current = reqwest::Url::parse("https://presensi.bkd.jatimprov.go.id/index.php/login")
            .expect("valid URL");
        assert_eq!(
            redirect_web_path(
                "https://presensi.bkd.jatimprov.go.id/index.php/default/index?next=1",
                &current
            )
            .expect("valid redirect"),
            "/p/default/index?next=1"
        );
    }

    #[test]
    fn web_presensi_cookies_are_retained_and_expired() {
        let mut jar = HashMap::new();
        let mut headers = reqwest::header::HeaderMap::new();
        headers.append(
            reqwest::header::SET_COOKIE,
            "epresensi-bkdjatim=session; Path=/"
                .parse()
                .expect("cookie header"),
        );
        simpan_cookie(&headers, &mut jar);
        assert_eq!(
            jar.get("epresensi-bkdjatim").map(String::as_str),
            Some("session")
        );

        headers.clear();
        headers.append(
            reqwest::header::SET_COOKIE,
            "epresensi-bkdjatim=; Max-Age=0"
                .parse()
                .expect("expired cookie header"),
        );
        simpan_cookie(&headers, &mut jar);
        assert!(!jar.contains_key("epresensi-bkdjatim"));
    }
}
