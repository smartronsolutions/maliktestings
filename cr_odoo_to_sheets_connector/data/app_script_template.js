/**
 * Odoo to Google Sheets Connector - Google Apps Script
 * Generated from Odoo module: cr_odoo_to_sheets_connector
 * Version: 19.0
 * 
 * Instructions:
 * 1. In Google Sheets, open Extensions >> Apps Script.
 * 2. Replace all code in Code.gs with this script.
 * 3. Save the project and refresh your Google Sheet.
 * 4. The 'Odoo Connector' menu will appear in the top menu bar.
 */

// Default credentials substituted dynamically by Odoo
var DEFAULT_ODOO_URL = "{{CONNECTOR_URL}}";
var DEFAULT_ACCESS_TOKEN = "{{ACCESS_TOKEN}}";

/**
 * Creates the Odoo Connector menu when spreadsheet opens.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Odoo Connector')
    .addItem('Set URL and Token', 'showSetUrlAndTokenDialog')
    .addItem('Select Tables and Fetch Data', 'showSelectTablesDialog')
    .addItem('Setup Automatic Import Refresh', 'showAutoImportRefreshDialog')
    .addItem('Setup Automatic Export Refresh', 'showAutoExportRefreshDialog')
    .addItem('Refresh Now', 'showRefreshNowDialog')
    .addSeparator()
    .addItem('Send Data To Odoo', 'showSendDataToOdooDialog')
    .addToUi();
}

/**
 * Normalizes URL to ensure proper protocol and remove trailing slash.
 */
function normalizeUrl(url) {
  if (!url) return "";
  url = url.trim().replace(/\/+$/, "");
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  return url;
}

/**
 * Safe UI Alert helper that doesn't crash in background trigger contexts.
 */
function safeAlert(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    Logger.log("UI Alert (Background Trigger Context): " + message);
  }
}

/**
 * Get configuration properties from Document Properties or fallback to defaults.
 */
function getConnectorConfig() {
  var props = PropertiesService.getDocumentProperties();
  var url = props.getProperty('ODOO_CONNECTOR_URL') || DEFAULT_ODOO_URL;
  var token = props.getProperty('ODOO_ACCESS_TOKEN') || DEFAULT_ACCESS_TOKEN;
  return {
    url: normalizeUrl(url),
    token: (token || "").trim()
  };
}

/**
 * Save configuration properties.
 */
function saveConnectorConfig(url, token) {
  var props = PropertiesService.getDocumentProperties();
  var cleanUrl = normalizeUrl(url);
  props.setProperty('ODOO_CONNECTOR_URL', cleanUrl);
  props.setProperty('ODOO_ACCESS_TOKEN', (token || "").trim());
  return { success: true, url: cleanUrl };
}

/**
 * Common HTTP request helper to call Odoo API endpoints.
 */
function callOdooApi(endpoint, payload) {
  var config = getConnectorConfig();
  if (!config.url || !config.token) {
    throw new Error("Odoo URL and Access Token are not configured. Please use 'Odoo Connector >> Set URL and Token' first.");
  }
  
  if (config.url.indexOf("localhost") > -1 || config.url.indexOf("127.0.0.1") > -1) {
    throw new Error("Google Sheets runs on Google Cloud servers and cannot reach 'localhost'. Please use your public Odoo domain/IP or an ngrok/Cloudflare tunnel URL.");
  }
  
  var payloadObj = payload || {};
  payloadObj.access_token = config.token;
  var sep = endpoint.indexOf("?") === -1 ? "?" : "&";
  var fullUrl = config.url + endpoint + sep + "access_token=" + encodeURIComponent(config.token);
  
  var headers = {
    "Authorization": "Bearer " + config.token,
    "Content-Type": "application/json"
  };
  
  var options = {
    "method": "post",
    "contentType": "application/json; charset=utf-8",
    "headers": headers,
    "payload": JSON.stringify(payloadObj),
    "muteHttpExceptions": true,
    "validateHttpsCertificates": false,
    "followRedirects": true
  };
  
  try {
    var response = UrlFetchApp.fetch(fullUrl, options);
    var code = response.getResponseCode();
    var text = response.getContentText();
    var json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error("Invalid response from Odoo (" + code + "): " + text.substring(0, 300));
    }
    
    if (json.error) {
      var errMsg = json.error.message || (json.error.data && json.error.data.message) || JSON.stringify(json.error);
      throw new Error("Odoo Error: " + errMsg);
    }
    
    var result = json.result !== undefined ? json.result : json;
    if (result.status === "error") {
      throw new Error(result.message || "Unknown error from Odoo connector.");
    }
    
    return result;
  } catch (err) {
    throw new Error("Failed to connect to Odoo: " + err.message);
  }
}

/**
 * Verify connection to Odoo server.
 */
function testOdooConnection(url, token) {
  var cleanUrl = normalizeUrl(url);
  if (!cleanUrl || !token) {
    return { success: false, message: "URL and Token cannot be empty." };
  }
  if (cleanUrl.indexOf("localhost") > -1 || cleanUrl.indexOf("127.0.0.1") > -1) {
    return {
      success: false,
      message: "Google Sheets runs on Google's cloud servers and cannot reach 'localhost'. Use a public domain, IP, or tunnel (e.g. ngrok)."
    };
  }
  
  var fullUrl = cleanUrl + "/api/odoo_to_sheets/test_connection?access_token=" + encodeURIComponent(token.trim());
  var options = {
    "method": "post",
    "headers": {
      "Authorization": "Bearer " + token.trim(),
      "Content-Type": "application/json"
    },
    "payload": JSON.stringify({ access_token: token.trim() }),
    "muteHttpExceptions": true,
    "validateHttpsCertificates": false
  };
  
  try {
    var response = UrlFetchApp.fetch(fullUrl, options);
    var code = response.getResponseCode();
    var text = response.getContentText();
    var json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return { success: false, message: "Server returned non-JSON response (" + code + "): " + text.substring(0, 150) };
    }
    var res = json.result !== undefined ? json.result : json;
    if (res.status === "success") {
      return { success: true, message: res.message || "Connection successful!" };
    } else {
      return { success: false, message: res.message || "Connection failed. Check Access Token." };
    }
  } catch (err) {
    return { success: false, message: "Connection error: " + err.message };
  }
}

// -------------------------------------------------------------
// Dialog: Set URL and Token
// -------------------------------------------------------------

function showSetUrlAndTokenDialog() {
  var config = getConnectorConfig();
  var html = HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head>' +
    '<style>' +
    'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 20px; color: #333; }' +
    '.form-group { margin-bottom: 16px; }' +
    'label { display: block; font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #4b5563; }' +
    'input[type="text"] { width: 100%; box-sizing: border-box; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; }' +
    'input[type="text"]:focus { outline: none; border-color: #714b67; box-shadow: 0 0 0 2px rgba(113,75,103,0.2); }' +
    '.btn { padding: 9px 16px; font-size: 13px; font-weight: 600; border-radius: 6px; border: none; cursor: pointer; }' +
    '.btn-primary { background-color: #714b67; color: white; }' +
    '.btn-primary:hover { background-color: #5c3b53; }' +
    '.btn-secondary { background-color: #e5e7eb; color: #374151; margin-right: 8px; }' +
    '.btn-secondary:hover { background-color: #d1d5db; }' +
    '#status { margin-top: 15px; font-size: 13px; padding: 10px; border-radius: 6px; display: none; line-height: 1.4; }' +
    '.success { background-color: #d1fae5; color: #065f46; display: block !important; }' +
    '.error { background-color: #fee2e2; color: #991b1b; display: block !important; }' +
    '.note { font-size: 11px; color: #6b7280; margin-top: 4px; }' +
    '</style></head><body>' +
    '<h3 style="margin-top:0; color:#111827;">Odoo Connector Configuration</h3>' +
    '<div class="form-group">' +
    '  <label>Connector Url</label>' +
    '  <input type="text" id="url" value="' + (config.url || "") + '" placeholder="https://your-odoo-domain.com"/>' +
    '  <div class="note">Enter your public Odoo domain or IP (not localhost, as Google Sheets runs in cloud).</div>' +
    '</div>' +
    '<div class="form-group">' +
    '  <label>Access Token</label>' +
    '  <input type="text" id="token" value="' + (config.token || "") + '" placeholder="e.g. 57983bd140e82a3ed686b401c179f649"/>' +
    '</div>' +
    '<div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px;">' +
    '  <button type="button" class="btn btn-secondary" onclick="testConnection()">Test Connection</button>' +
    '  <button type="button" class="btn btn-primary" onclick="saveConfig()">Save Settings</button>' +
    '</div>' +
    '<div id="status"></div>' +
    '<script>' +
    'function testConnection() {' +
    '  var url = document.getElementById("url").value.trim();' +
    '  var token = document.getElementById("token").value.trim();' +
    '  var st = document.getElementById("status");' +
    '  st.className = ""; st.style.display = "block"; st.innerHTML = "Testing connection...";' +
    '  google.script.run.withSuccessHandler(function(res) {' +
    '    if(res.success) { st.className = "success"; st.innerHTML = res.message; }' +
    '    else { st.className = "error"; st.innerHTML = res.message; }' +
    '  }).withFailureHandler(function(err) {' +
    '    st.className = "error"; st.innerHTML = err.message;' +
    '  }).testOdooConnection(url, token);' +
    '}' +
    'function saveConfig() {' +
    '  var url = document.getElementById("url").value.trim();' +
    '  var token = document.getElementById("token").value.trim();' +
    '  var st = document.getElementById("status");' +
    '  st.className = ""; st.style.display = "block"; st.innerHTML = "Saving...";' +
    '  google.script.run.withSuccessHandler(function(res) {' +
    '    st.className = "success"; st.innerHTML = "Configuration saved successfully!";' +
    '    setTimeout(function() { google.script.host.close(); }, 1200);' +
    '  }).withFailureHandler(function(err) {' +
    '    st.className = "error"; st.innerHTML = err.message;' +
    '  }).saveConnectorConfig(url, token);' +
    '}' +
    '</script></body></html>'
  ).setWidth(500).setHeight(360);
  SpreadsheetApp.getUi().showModalDialog(html, 'Set URL and Token');
}

// -------------------------------------------------------------
// Dialog: Select Tables and Fetch Data (2-Step Wizard)
// -------------------------------------------------------------

function showSelectTablesDialog() {
  var html = HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head>' +
    '<style>' +
    'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 16px; margin:0; color:#333; }' +
    '.search-box { width: 100%; box-sizing: border-box; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; margin-bottom: 12px; font-size:13px; }' +
    '.list-container { max-height: 280px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 6px; padding: 4px; }' +
    '.item-row { display: flex; align-items: center; padding: 8px 10px; border-radius: 4px; cursor: pointer; border-bottom: 1px solid #f3f4f6; }' +
    '.item-row:hover { background-color: #f9fafb; }' +
    '.item-row input { margin-right: 10px; }' +
    '.item-title { font-size: 13px; font-weight: 500; color: #1f2937; }' +
    '.item-sub { font-size: 11px; color: #6b7280; margin-left: 6px; }' +
    '.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }' +
    '.btn { padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 6px; border:none; cursor:pointer; }' +
    '.btn-primary { background-color: #714b67; color: white; }' +
    '.btn-secondary { background-color: #e5e7eb; color: #374151; }' +
    '.header-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; color: #111827; }' +
    '#loader { text-align: center; padding: 30px; font-size: 13px; color: #6b7280; }' +
    '</style></head><body>' +
    '<div id="step1">' +
    '  <div class="header-title">Step 1: Select Tables</div>' +
    '  <input type="text" class="search-box" id="tableSearch" placeholder="Search tables..." oninput="filterTables()"/>' +
    '  <div id="loader">Loading tables from Odoo...</div>' +
    '  <div class="list-container" id="tablesList" style="display:none;"></div>' +
    '  <div class="actions">' +
    '    <button class="btn btn-secondary" onclick="google.script.host.close()">Cancel</button>' +
    '    <button class="btn btn-primary" id="btnNext" onclick="goToStep2()" disabled>Next: Select Columns</button>' +
    '  </div>' +
    '</div>' +
    '<div id="step2" style="display:none;">' +
    '  <div class="header-title">Step 2: Select Columns</div>' +
    '  <input type="text" class="search-box" id="fieldSearch" placeholder="Search fields..." oninput="filterFields()"/>' +
    '  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:12px; color:#4b5563;">' +
    '    <label style="cursor:pointer;"><input type="checkbox" id="chkAllFields" onchange="toggleAllFields(this.checked)"/> <b>Select All Fields</b></label>' +
    '    <span id="selectedCount">0 selected</span>' +
    '  </div>' +
    '  <div class="list-container" id="fieldsList"></div>' +
    '  <div class="actions">' +
    '    <button class="btn btn-secondary" onclick="goToStep1()">Back</button>' +
    '    <button class="btn btn-primary" id="btnFetch" onclick="doFetchData()">Fetch Data</button>' +
    '  </div>' +
    '</div>' +
    '<script>' +
    'var models = [];' +
    'var selectedModel = null;' +
    'var fields = [];' +
    'function loadTables() {' +
    '  document.getElementById("loader").style.display = "block";' +
    '  document.getElementById("loader").innerHTML = "Loading tables from Odoo...";' +
    '  document.getElementById("tablesList").style.display = "none";' +
    '  google.script.run.withSuccessHandler(function(res) {' +
    '    models = (res && res.data) ? res.data : [];' +
    '    renderTables(models);' +
    '    document.getElementById("loader").style.display = "none";' +
    '    document.getElementById("tablesList").style.display = "block";' +
    '  }).withFailureHandler(function(err) {' +
    '    document.getElementById("loader").innerHTML = "<div style=\'color:#dc2626; padding:12px; font-weight:600; line-height:1.4;\'>Failed to load tables:<br/><span style=\'font-size:12px; font-weight:normal; color:#b91c1c;\'>" + err.message + "</span><br/><button onclick=\'loadTables()\' style=\'margin-top:8px; padding:4px 10px; cursor:pointer;\'>Retry</button></div>";' +
    '  }).getOdooModels();' +
    '}' +
    'loadTables();' +
    'function renderTables(list) {' +
    '  var container = document.getElementById("tablesList");' +
    '  container.innerHTML = "";' +
    '  if (!list || list.length === 0) {' +
    '    container.innerHTML = "<div style=\'padding:10px; color:#666;\'>No tables found.</div>";' +
    '    return;' +
    '  }' +
    '  for (var i = 0; i < list.length; i++) {' +
    '    (function(m) {' +
    '      var row = document.createElement("div");' +
    '      row.className = "item-row";' +
    '      row.onclick = function() { selectTable(m.model); };' +
    '      var rad = document.createElement("input");' +
    '      rad.type = "radio";' +
    '      rad.name = "tableRadio";' +
    '      rad.id = "rad_" + m.model;' +
    '      rad.value = m.model;' +
    '      var title = document.createElement("span");' +
    '      title.className = "item-title";' +
    '      title.textContent = m.name || m.model;' +
    '      var sub = document.createElement("span");' +
    '      sub.className = "item-sub";' +
    '      sub.textContent = " (" + m.model + ")";' +
    '      row.appendChild(rad);' +
    '      row.appendChild(title);' +
    '      row.appendChild(sub);' +
    '      container.appendChild(row);' +
    '    })(list[i]);' +
    '  }' +
    '}' +
    'function filterTables() {' +
    '  var q = document.getElementById("tableSearch").value.toLowerCase();' +
    '  var filtered = models.filter(function(m) { return m.name.toLowerCase().indexOf(q) > -1 || m.model.toLowerCase().indexOf(q) > -1; });' +
    '  renderTables(filtered);' +
    '}' +
    'function selectTable(m) {' +
    '  selectedModel = m;' +
    '  var rad = document.getElementById("rad_" + m);' +
    '  if (rad) rad.checked = true;' +
    '  document.getElementById("btnNext").disabled = false;' +
    '}' +
    'function goToStep1() {' +
    '  document.getElementById("step2").style.display = "none";' +
    '  document.getElementById("step1").style.display = "block";' +
    '}' +
    'function goToStep2() {' +
    '  if (!selectedModel) {' +
    '    var chk = document.querySelector(\'input[name="tableRadio"]:checked\');' +
    '    if (chk && chk.value) { selectedModel = chk.value; }' +
    '  }' +
    '  if (!selectedModel || selectedModel === "null" || selectedModel === "undefined") {' +
    '    alert("Please select a table from the list first."); return;' +
    '  }' +
    '  document.getElementById("step1").style.display = "none";' +
    '  document.getElementById("step2").style.display = "block";' +
    '  document.getElementById("fieldsList").innerHTML = "<div style=\'padding:20px; text-align:center;\'>Loading fields for " + selectedModel + "...</div>";' +
    '  google.script.run.withSuccessHandler(function(res) {' +
    '    fields = (res && res.data) ? res.data : [];' +
    '    renderFields(fields);' +
    '    toggleAllFields(true);' +
    '    document.getElementById("chkAllFields").checked = true;' +
    '  }).withFailureHandler(function(err) {' +
    '    document.getElementById("fieldsList").innerHTML = "<div style=\'color:red; padding:10px; font-weight:bold;\'>" + err.message + "</div>";' +
    '  }).getOdooFields(selectedModel);' +
    '}' +
    'function renderFields(list) {' +
    '  var container = document.getElementById("fieldsList");' +
    '  container.innerHTML = "";' +
    '  if (!list || list.length === 0) {' +
    '    container.innerHTML = "<div style=\'padding:10px; color:#666;\'>No fields found.</div>";' +
    '    return;' +
    '  }' +
    '  for (var i = 0; i < list.length; i++) {' +
    '    var f = list[i];' +
    '    var row = document.createElement("div");' +
    '    row.className = "item-row";' +
    '    var chk = document.createElement("input");' +
    '    chk.type = "checkbox";' +
    '    chk.className = "field-chk";' +
    '    chk.id = "fld_" + f.name;' +
    '    chk.value = f.name;' +
    '    chk.onchange = updateCount;' +
    '    var lbl = document.createElement("label");' +
    '    lbl.htmlFor = "fld_" + f.name;' +
    '    lbl.style.cursor = "pointer";' +
    '    lbl.style.flex = "1";' +
    '    var title = document.createElement("span");' +
    '    title.className = "item-title";' +
    '    title.textContent = f.string || f.name;' +
    '    var sub = document.createElement("span");' +
    '    sub.className = "item-sub";' +
    '    sub.textContent = " (" + f.name + ")";' +
    '    lbl.appendChild(title);' +
    '    lbl.appendChild(sub);' +
    '    row.appendChild(chk);' +
    '    row.appendChild(lbl);' +
    '    container.appendChild(row);' +
    '  }' +
    '}' +
    'function filterFields() {' +
    '  var q = document.getElementById("fieldSearch").value.toLowerCase();' +
    '  var filtered = fields.filter(function(f) { return f.string.toLowerCase().indexOf(q) > -1 || f.name.toLowerCase().indexOf(q) > -1; });' +
    '  renderFields(filtered);' +
    '}' +
    'function toggleAllFields(check) {' +
    '  var chks = document.getElementsByClassName("field-chk");' +
    '  for (var i = 0; i < chks.length; i++) { chks[i].checked = check; }' +
    '  updateCount();' +
    '}' +
    'function updateCount() {' +
    '  var chks = document.getElementsByClassName("field-chk");' +
    '  var cnt = 0;' +
    '  for (var i = 0; i < chks.length; i++) { if (chks[i].checked) cnt++; }' +
    '  document.getElementById("selectedCount").innerText = cnt + " selected";' +
    '}' +
    'function doFetchData() {' +
    '  var chks = document.getElementsByClassName("field-chk");' +
    '  var selectedFields = [];' +
    '  for (var i = 0; i < chks.length; i++) { if (chks[i].checked) selectedFields.push(chks[i].value); }' +
    '  if (selectedFields.length === 0) { alert("Please select at least one field."); return; }' +
    '  document.getElementById("btnFetch").disabled = true;' +
    '  document.getElementById("btnFetch").innerText = "Fetching...";' +
    '  google.script.run.withSuccessHandler(function(res) {' +
    '    google.script.host.close();' +
    '  }).withFailureHandler(function(err) {' +
    '    alert("Fetch failed: " + err.message);' +
    '    document.getElementById("btnFetch").disabled = false;' +
    '    document.getElementById("btnFetch").innerText = "Fetch Data";' +
    '  }).processFetchData(selectedModel, selectedFields);' +
    '}' +
    '</script></body></html>'
  ).setWidth(520).setHeight(450);
  SpreadsheetApp.getUi().showModalDialog(html, 'Select Tables and Fetch Data');
}

/**
 * Server functions called by Step 1 & Step 2 Dialogs
 */
function getOdooModels() {
  return callOdooApi("/api/odoo_to_sheets/models", {});
}

function getOdooFields(modelName) {
  if (!modelName || modelName === "null" || modelName === "undefined") {
    throw new Error("No table selected. Please click 'Back' and select a table from the list.");
  }
  return callOdooApi("/api/odoo_to_sheets/fields?model=" + encodeURIComponent(modelName), { model: modelName });
}

function processFetchData(modelName, selectedFields) {
  if (!modelName || modelName === "null" || modelName === "undefined") {
    throw new Error("No table selected. Please select a table first.");
  }
  var res = callOdooApi("/api/odoo_to_sheets/fetch_data?model=" + encodeURIComponent(modelName), {
    model: modelName,
    fields: selectedFields
  });
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(modelName);
  if (!sheet) {
    sheet = ss.insertSheet(modelName);
  } else {
    sheet.clear();
  }
  
  var headers = res.headers || selectedFields;
  var rows = res.data || [];
  
  // Write headers
  var output = [headers];
  for (var i = 0; i < rows.length; i++) {
    var rowData = [];
    for (var j = 0; j < headers.length; j++) {
      var val = rows[i][headers[j]];
      if (val === null || val === undefined) {
        val = "";
      } else if (typeof val === "object") {
        val = JSON.stringify(val);
      }
      rowData.push(val);
    }
    output.push(rowData);
  }
  
  if (output.length > 0 && output[0].length > 0) {
    var maxCols = sheet.getMaxColumns();
    if (maxCols < output[0].length) {
      sheet.insertColumnsAfter(maxCols, output[0].length - maxCols);
    }
    var maxRows = sheet.getMaxRows();
    if (maxRows < output.length) {
      sheet.insertRowsAfter(maxRows, output.length - maxRows);
    }
    var range = sheet.getRange(1, 1, output.length, output[0].length);
    range.setValues(output);
    
    // Format header row
    var headerRange = sheet.getRange(1, 1, 1, output[0].length);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#f3f4f6");
    headerRange.setBorder(true, true, true, true, true, true, "#d1d5db", SpreadsheetApp.BorderStyle.SOLID);
  }
  
  ss.setActiveSheet(sheet);
  safeAlert("Fetched " + rows.length + " records into sheet '" + modelName + "'.");
  return { success: true, count: rows.length };
}

// -------------------------------------------------------------
// Dialog: Send Data To Odoo (Export)
// -------------------------------------------------------------

function showSendDataToOdooDialog() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var sheetNames = [];
  for (var i = 0; i < sheets.length; i++) {
    sheetNames.push(sheets[i].getName());
  }
  
  var html = HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head>' +
    '<style>' +
    'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 16px; margin:0; color:#333; }' +
    '.search-box { width: 100%; box-sizing: border-box; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; margin-bottom: 12px; font-size:13px; }' +
    '.list-container { max-height: 280px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 6px; padding: 4px; }' +
    '.item-row { display: flex; align-items: center; padding: 8px 10px; border-radius: 4px; cursor: pointer; border-bottom: 1px solid #f3f4f6; }' +
    '.item-row:hover { background-color: #f9fafb; }' +
    '.item-row input { margin-right: 10px; }' +
    '.item-title { font-size: 13px; font-weight: 500; color: #1f2937; }' +
    '.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }' +
    '.btn { padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 6px; border:none; cursor:pointer; }' +
    '.btn-primary { background-color: #714b67; color: white; }' +
    '.btn-secondary { background-color: #e5e7eb; color: #374151; }' +
    '.header-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; color: #111827; }' +
    '</style></head><body>' +
    '<div id="step1">' +
    '  <div class="header-title">Step 1: Select Sheets to Export</div>' +
    '  <div class="list-container" id="sheetsList"></div>' +
    '  <div class="actions">' +
    '    <button class="btn btn-secondary" onclick="google.script.host.close()">Cancel</button>' +
    '    <button class="btn btn-primary" id="btnNext" onclick="goToStep2()" disabled>Next: Select Columns</button>' +
    '  </div>' +
    '</div>' +
    '<div id="step2" style="display:none;">' +
    '  <div class="header-title">Step 2: Select Columns to Export</div>' +
    '  <input type="text" class="search-box" id="colSearch" placeholder="Search columns..." oninput="filterColumns()"/>' +
    '  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:12px; color:#4b5563;">' +
    '    <label style="cursor:pointer;"><input type="checkbox" id="chkAllCols" onchange="toggleAllCols(this.checked)"/> <b>Select All Columns</b></label>' +
    '    <span id="selectedCount">0 selected</span>' +
    '  </div>' +
    '  <div class="list-container" id="colsList"></div>' +
    '  <div class="actions">' +
    '    <button class="btn btn-secondary" onclick="goToStep1()">Back</button>' +
    '    <button class="btn btn-primary" id="btnExport" onclick="doExportData()">Export Data</button>' +
    '  </div>' +
    '</div>' +
    '<script>' +
    'var allSheets = ' + JSON.stringify(sheetNames) + ';' +
    'var selectedSheet = null;' +
    'var columns = [];' +
    'function initSheets() {' +
    '  var html = "";' +
    '  for (var i = 0; i < allSheets.length; i++) {' +
    '    var s = allSheets[i];' +
    '    html += "<div class=\'item-row\' onclick=\'selectSheet(\"" + s + "\")\'>" +' +
    '            "<input type=\'radio\' name=\'sheetRadio\' id=\'s_" + s + "\' value=\'" + s + "\'/>" +' +
    '            "<span class=\'item-title\'>" + s + "</span></div>";' +
    '  }' +
    '  document.getElementById("sheetsList").innerHTML = html || "No sheets found.";' +
    '}' +
    'initSheets();' +
    'function selectSheet(s) {' +
    '  selectedSheet = s;' +
    '  var rad = document.getElementById("s_" + s);' +
    '  if (rad) rad.checked = true;' +
    '  document.getElementById("btnNext").disabled = false;' +
    '}' +
    'function goToStep1() {' +
    '  document.getElementById("step2").style.display = "none";' +
    '  document.getElementById("step1").style.display = "block";' +
    '}' +
    'function goToStep2() {' +
    '  if (!selectedSheet) return;' +
    '  document.getElementById("step1").style.display = "none";' +
    '  document.getElementById("step2").style.display = "block";' +
    '  google.script.run.withSuccessHandler(function(headers) {' +
    '    columns = headers || [];' +
    '    renderCols(columns);' +
    '    toggleAllCols(true);' +
    '    document.getElementById("chkAllCols").checked = true;' +
    '  }).getSheetHeaders(selectedSheet);' +
    '}' +
    'function renderCols(list) {' +
    '  var html = "";' +
    '  for (var i = 0; i < list.length; i++) {' +
    '    var c = list[i];' +
    '    html += "<div class=\'item-row\'>" +' +
    '            "<input type=\'checkbox\' class=\'col-chk\' id=\'col_" + c + "\' value=\'" + c + "\' onchange=\'updateCount()\'/>" +' +
    '            "<label for=\'col_" + c + "\' style=\'cursor:pointer; flex:1;\'>" +' +
    '            "<span class=\'item-title\'>" + c + "</span></label></div>";' +
    '  }' +
    '  document.getElementById("colsList").innerHTML = html || "No columns found.";' +
    '}' +
    'function filterColumns() {' +
    '  var q = document.getElementById("colSearch").value.toLowerCase();' +
    '  var filtered = columns.filter(function(c) { return c.toLowerCase().indexOf(q) > -1; });' +
    '  renderCols(filtered);' +
    '}' +
    'function toggleAllCols(check) {' +
    '  var chks = document.getElementsByClassName("col-chk");' +
    '  for (var i = 0; i < chks.length; i++) { chks[i].checked = check; }' +
    '  updateCount();' +
    '}' +
    'function updateCount() {' +
    '  var chks = document.getElementsByClassName("col-chk");' +
    '  var cnt = 0;' +
    '  for (var i = 0; i < chks.length; i++) { if (chks[i].checked) cnt++; }' +
    '  document.getElementById("selectedCount").innerText = cnt + " selected";' +
    '}' +
    'function doExportData() {' +
    '  var chks = document.getElementsByClassName("col-chk");' +
    '  var selectedCols = [];' +
    '  for (var i = 0; i < chks.length; i++) { if (chks[i].checked) selectedCols.push(chks[i].value); }' +
    '  if (selectedCols.length === 0) { alert("Please select at least one column."); return; }' +
    '  document.getElementById("btnExport").disabled = true;' +
    '  document.getElementById("btnExport").innerText = "Exporting...";' +
    '  google.script.run.withSuccessHandler(function(res) {' +
    '    google.script.host.close();' +
    '  }).withFailureHandler(function(err) {' +
    '    alert("Export failed: " + err.message);' +
    '    document.getElementById("btnExport").disabled = false;' +
    '    document.getElementById("btnExport").innerText = "Export Data";' +
    '  }).processExportData(selectedSheet, selectedCols);' +
    '}' +
    '</script></body></html>'
  ).setWidth(520).setHeight(450);
  SpreadsheetApp.getUi().showModalDialog(html, 'Send Data To Odoo');
}

function getSheetHeaders(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  var vals = sheet.getRange(1, 1, 1, lastCol).getValues();
  return vals[0] || [];
}

function processExportData(sheetName, selectedColumns) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet '" + sheetName + "' not found.");
  
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    throw new Error("No data rows found in sheet to export.");
  }
  
  var allData = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = allData[0];
  var colIndices = {};
  for (var c = 0; c < headers.length; c++) {
    colIndices[headers[c]] = c;
  }
  
  // Ensure 'id' column is included if present in sheet headers
  var hasIdInSheet = (colIndices['id'] !== undefined);
  var exportFields = selectedColumns.slice();
  if (hasIdInSheet && exportFields.indexOf('id') === -1) {
    exportFields.push('id');
  }
  
  var rows = [];
  for (var r = 1; r < allData.length; r++) {
    var rowObj = {};
    for (var f = 0; f < exportFields.length; f++) {
      var fName = exportFields[f];
      var idx = colIndices[fName];
      if (idx !== undefined) {
        rowObj[fName] = allData[r][idx];
      }
    }
    rows.push(rowObj);
  }
  
  var res = callOdooApi("/api/odoo_to_sheets/export_data", {
    model: sheetName,
    rows: rows
  });
  
  var msg = "Export finished for " + sheetName + ":\n" +
            "Total Records: " + (res.total_records || rows.length) + "\n" +
            "Successful: " + (res.successful_records || 0) + "\n" +
            "Failed: " + (res.failed_records || 0);
  if (res.errors && res.errors.length > 0) {
    msg += "\nErrors:\n" + res.errors.slice(0, 5).join("\n");
  }
  safeAlert(msg);
  return res;
}

// -------------------------------------------------------------
// Dialog: Setup Automatic Import Refresh
// -------------------------------------------------------------

function showAutoImportRefreshDialog() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var sheetNames = [];
  for (var i = 0; i < sheets.length; i++) {
    sheetNames.push(sheets[i].getName());
  }
  
  var html = HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head>' +
    '<style>' +
    'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 16px; margin:0; color:#333; }' +
    '.header-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; color: #111827; }' +
    '.sheet-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; }' +
    '.sheet-name { font-weight: 500; font-size: 13px; }' +
    '.interval-input { width: 70px; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; }' +
    '.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }' +
    '.btn { padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 6px; border:none; cursor:pointer; }' +
    '.btn-primary { background-color: #714b67; color: white; }' +
    '.btn-secondary { background-color: #e5e7eb; color: #374151; }' +
    '</style></head><body>' +
    '<div class="header-title">Automatic Import Refresh</div>' +
    '<div style="max-height: 280px; overflow-y: auto;" id="list"></div>' +
    '<div class="actions">' +
    '  <button class="btn btn-secondary" onclick="google.script.host.close()">Cancel</button>' +
    '  <button class="btn btn-primary" onclick="saveSchedulers()">Create Schedulers</button>' +
    '</div>' +
    '<script>' +
    'var sheets = ' + JSON.stringify(sheetNames) + ';' +
    'function initImportRows() {' +
    '  var html = "";' +
    '  for (var i = 0; i < sheets.length; i++) {' +
    '    html += "<div class=\'sheet-row\'>" +' +
    '            "<span class=\'sheet-name\'>" + sheets[i] + "</span>" +' +
    '            "<div><input type=\'number\' min=\'1\' max=\'24\' placeholder=\'Hours\' class=\'interval-input\' id=\'h_" + sheets[i] + "\'/> <span style=\'font-size:12px; color:#666;\'>Hours</span></div>" +' +
    '            "</div>";' +
    '  }' +
    '  document.getElementById("list").innerHTML = html;' +
    '}' +
    'initImportRows();' +
    'function saveSchedulers() {' +
    '  var configs = {};' +
    '  for (var i = 0; i < sheets.length; i++) {' +
    '    var val = document.getElementById("h_" + sheets[i]).value;' +
    '    if (val && parseInt(val) > 0) { configs[sheets[i]] = parseInt(val); }' +
    '  }' +
    '  google.script.run.withSuccessHandler(function() {' +
    '    alert("Import schedulers successfully set up!");' +
    '    google.script.host.close();' +
    '  }).setupImportTriggers(configs);' +
    '}' +
    '</script></body></html>'
  ).setWidth(480).setHeight(400);
  SpreadsheetApp.getUi().showModalDialog(html, 'Automatic Import Refresh');
}

function setupImportTriggers(configs) {
  var props = PropertiesService.getDocumentProperties();
  props.setProperty('IMPORT_INTERVAL_CONFIGS', JSON.stringify(configs));
  
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runAutoImportRefresh') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  var minHours = 1;
  for (var k in configs) {
    if (configs[k] < minHours) minHours = configs[k];
  }
  
  if (Object.keys(configs).length > 0) {
    ScriptApp.newTrigger('runAutoImportRefresh')
      .timeBased()
      .everyHours(minHours)
      .create();
  }
}

function runAutoImportRefresh() {
  var props = PropertiesService.getDocumentProperties();
  var raw = props.getProperty('IMPORT_INTERVAL_CONFIGS');
  if (!raw) return;
  var configs = JSON.parse(raw);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  for (var sheetName in configs) {
    try {
      var sheet = ss.getSheetByName(sheetName);
      if (sheet) {
        var headers = getSheetHeaders(sheetName);
        if (headers && headers.length > 0) {
          processFetchData(sheetName, headers);
        }
      }
    } catch (e) {
      Logger.log("Auto import failed for " + sheetName + ": " + e.message);
    }
  }
}

// -------------------------------------------------------------
// Dialog: Setup Automatic Export Refresh
// -------------------------------------------------------------

function showAutoExportRefreshDialog() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var sheetNames = [];
  for (var i = 0; i < sheets.length; i++) {
    sheetNames.push(sheets[i].getName());
  }
  
  var html = HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head>' +
    '<style>' +
    'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 16px; margin:0; color:#333; }' +
    '.header-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; color: #111827; }' +
    '.sheet-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; }' +
    '.sheet-name { font-weight: 500; font-size: 13px; }' +
    '.interval-input { width: 70px; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; }' +
    '.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }' +
    '.btn { padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 6px; border:none; cursor:pointer; }' +
    '.btn-primary { background-color: #714b67; color: white; }' +
    '.btn-secondary { background-color: #e5e7eb; color: #374151; }' +
    '</style></head><body>' +
    '<div class="header-title">Automatic Export Refresh</div>' +
    '<div style="max-height: 280px; overflow-y: auto;" id="list"></div>' +
    '<div class="actions">' +
    '  <button class="btn btn-secondary" onclick="google.script.host.close()">Cancel</button>' +
    '  <button class="btn btn-primary" onclick="saveSchedulers()">Create Export Schedulers</button>' +
    '</div>' +
    '<script>' +
    'var sheets = ' + JSON.stringify(sheetNames) + ';' +
    'function initImportRows() {' +
    '  var html = "";' +
    '  for (var i = 0; i < sheets.length; i++) {' +
    '    html += "<div class=\'sheet-row\'>" +' +
    '            "<span class=\'sheet-name\'>" + sheets[i] + "</span>" +' +
    '            "<div><input type=\'number\' min=\'1\' max=\'24\' placeholder=\'Hours\' class=\'interval-input\' id=\'h_" + sheets[i] + "\'/> <span style=\'font-size:12px; color:#666;\'>Hours</span></div>" +' +
    '            "</div>";' +
    '  }' +
    '  document.getElementById("list").innerHTML = html;' +
    '}' +
    'initImportRows();' +
    'function saveSchedulers() {' +
    '  var configs = {};' +
    '  for (var i = 0; i < sheets.length; i++) {' +
    '    var val = document.getElementById("h_" + sheets[i]).value;' +
    '    if (val && parseInt(val) > 0) { configs[sheets[i]] = parseInt(val); }' +
    '  }' +
    '  google.script.run.withSuccessHandler(function() {' +
    '    alert("Export schedulers successfully set up!");' +
    '    google.script.host.close();' +
    '  }).setupExportTriggers(configs);' +
    '}' +
    '</script></body></html>'
  ).setWidth(480).setHeight(400);
  SpreadsheetApp.getUi().showModalDialog(html, 'Automatic Export Refresh');
}

function setupExportTriggers(configs) {
  var props = PropertiesService.getDocumentProperties();
  props.setProperty('EXPORT_INTERVAL_CONFIGS', JSON.stringify(configs));
  
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runAutoExportRefresh') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  var minHours = 1;
  for (var k in configs) {
    if (configs[k] < minHours) minHours = configs[k];
  }
  
  if (Object.keys(configs).length > 0) {
    ScriptApp.newTrigger('runAutoExportRefresh')
      .timeBased()
      .everyHours(minHours)
      .create();
  }
}

function runAutoExportRefresh() {
  var props = PropertiesService.getDocumentProperties();
  var raw = props.getProperty('EXPORT_INTERVAL_CONFIGS');
  if (!raw) return;
  var configs = JSON.parse(raw);
  for (var sheetName in configs) {
    try {
      var headers = getSheetHeaders(sheetName);
      if (headers && headers.length > 0) {
        processExportData(sheetName, headers);
      }
    } catch (e) {
      Logger.log("Auto export failed for " + sheetName + ": " + e.message);
    }
  }
}

// -------------------------------------------------------------
// Dialog: Refresh Now
// -------------------------------------------------------------

function showRefreshNowDialog() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var sheetNames = [];
  for (var i = 0; i < sheets.length; i++) {
    sheetNames.push(sheets[i].getName());
  }
  
  var html = HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head>' +
    '<style>' +
    'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 16px; margin:0; color:#333; }' +
    '.header-title { font-size: 15px; font-weight: 600; margin-bottom: 6px; color: #111827; }' +
    '.sub-title { font-size: 12px; color: #6b7280; margin-bottom: 12px; }' +
    '.sheet-row { display: flex; align-items: center; padding: 8px 10px; border-bottom: 1px solid #f3f4f6; }' +
    '.sheet-row input { margin-right: 10px; }' +
    '.sheet-name { font-weight: 500; font-size: 13px; cursor: pointer; }' +
    '.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }' +
    '.btn { padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 6px; border:none; cursor:pointer; }' +
    '.btn-primary { background-color: #714b67; color: white; }' +
    '.btn-secondary { background-color: #e5e7eb; color: #374151; }' +
    '</style></head><body>' +
    '<div class="header-title">Refresh Selected Sheets</div>' +
    '<div class="sub-title">Select sheets to refresh from Odoo</div>' +
    '<div style="max-height: 250px; overflow-y: auto;" id="list"></div>' +
    '<div class="actions">' +
    '  <button class="btn btn-secondary" onclick="google.script.host.close()">Cancel</button>' +
    '  <button class="btn btn-primary" id="btnRefresh" onclick="doRefresh()">Refresh Selected</button>' +
    '</div>' +
    '<script>' +
    'var sheets = ' + JSON.stringify(sheetNames) + ';' +
    'function initRefreshRows() {' +
    '  var html = "";' +
    '  for (var i = 0; i < sheets.length; i++) {' +
    '    html += "<div class=\'sheet-row\'>" +' +
    '            "<input type=\'checkbox\' class=\'ref-chk\' id=\'chk_" + sheets[i] + "\' value=\'" + sheets[i] + "\'/>" +' +
    '            "<label for=\'chk_" + sheets[i] + "\' class=\'sheet-name\'>" + sheets[i] + "</label>" +' +
    '            "</div>";' +
    '  }' +
    '  document.getElementById("list").innerHTML = html;' +
    '}' +
    'initRefreshRows();' +
    'function doRefresh() {' +
    '  var chks = document.getElementsByClassName("ref-chk");' +
    '  var selected = [];' +
    '  for (var i = 0; i < chks.length; i++) { if (chks[i].checked) selected.push(chks[i].value); }' +
    '  if (selected.length === 0) { alert("Please select at least one sheet."); return; }' +
    '  document.getElementById("btnRefresh").disabled = true;' +
    '  document.getElementById("btnRefresh").innerText = "Refreshing...";' +
    '  google.script.run.withSuccessHandler(function() {' +
    '    alert("Refresh complete!");' +
    '    google.script.host.close();' +
    '  }).withFailureHandler(function(err) {' +
    '    alert("Refresh failed: " + err.message);' +
    '    document.getElementById("btnRefresh").disabled = false;' +
    '    document.getElementById("btnRefresh").innerText = "Refresh Selected";' +
    '  }).refreshSelectedSheets(selected);' +
    '}' +
    '</script></body></html>'
  ).setWidth(480).setHeight(380);
  SpreadsheetApp.getUi().showModalDialog(html, 'Refresh Now');
}

function refreshSelectedSheets(selectedSheetNames) {
  for (var i = 0; i < selectedSheetNames.length; i++) {
    var sheetName = selectedSheetNames[i];
    var headers = getSheetHeaders(sheetName);
    if (headers && headers.length > 0) {
      processFetchData(sheetName, headers);
    }
  }
}
