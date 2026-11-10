// Internal HTTP-shaped codes. Product screening results are 2xx decisions;
// operational failures are 4xx/5xx; unknown reasons always become 501.
const groups = [
 [200,'commander','keep_running',['RUNNING','discovering','recovering','running_batch','RETRY_SCHEDULED','new_ranking_cycle','USER_STOPPED','stopped','source_exhausted','complete']],
 [210,'screening_agent','record_exclusion',['NO_AVAILABLE_STOCK','NO_POSITIVE_MARGIN_IN_BOUND_AVAILABLE_OPTIONS','POIZON_NO_POSITIVE_MARGIN','POIZON_BID_UNAVAILABLE','NO_MARKET_QUALIFYING_OPTION']],
 [211,'screening_agent','record_exclusion',['EXACT_MARKET_MODEL_NOT_FOUND','POIZON_EXACT_MODEL_NOT_FOUND','POIZON_AVAILABLE_OPTION_NOT_BOUND','POIZON_PRICE_NOT_FOUND','MARKET_MODEL_AMBIGUOUS','SOURCE_MODEL_MISSING','UNSUPPORTED_SOURCE_MODEL_FORMAT','AVAILABLE_OPTION_NOT_BOUND','NO1_OPTION_NOT_FOUND','NO1_IDENTITY_MISMATCH']],
 [212,'screening_agent','record_exclusion',['DUPLICATE_KREAM_PRODUCT','DUPLICATE_POIZON_PRODUCT']],
 [400,'diagnostic_agent','record_unknown_error',['NO1_INVALID_PAYLOAD','NO1_INVALID_BRIDGE_CONFIG','NO1_INVALID_RESPONSE','NO1_SCHEMA_AMBIGUOUS','NO1_SCHEMA_NOT_AVAILABLE','RANKING_SETTINGS_CHANGED','PENDING_PACKET_MISSING','PENDING_PACKET_SOURCE_MISSING','MUSINSA_PACKET_MISSING','PACKET_INTEGRITY_FAILED','IDENTITY_MISMATCH','INVALID_BRIDGE_ORIGIN','INVALID_REMOTE_JOB']],
 [401,'auth_agent','request_login',['NO1_AUTH_REQUIRED','NO1_PLATFORM_LOGIN_REQUIRED','MUSINSA_LOGIN_REQUIRED','KREAM_LOGIN_REQUIRED','POIZON_LOGIN_REQUIRED','KREAM_TOKEN_EXPIRED','TOKEN_EXPIRED']],
 [401,'remote_bridge_agent','request_remote_pairing',['BRIDGE_HTTP_401']],
 [403,'diagnostic_agent','record_unknown_error',['NO1_BACKGROUND_MODE_REQUIRED','NO1_COMMAND_FORBIDDEN','REMOTE_COMMAND_FORBIDDEN','NO1_PRODUCT_QUERIES_UNVERIFIED','CMD_NOT_FOUND']],
 [404,'browser_connection_agent','wait_for_authenticated_tab',['NO1_WEB_TAB_REQUIRED','NO1_BROWSER_ACCESS_FAILED','NO1_MULTIPLE_WEB_SESSIONS']],
 [409,'diagnostic_agent','record_unknown_error',['EXPLORATION_ALREADY_RUNNING','WATCHDOG_ALREADY_RUNNING','ACTIVE_BATCH_EXISTS','BRIDGE_ALREADY_RUNNING']],
 [426,'connector_agent','request_connector_reload',['NO1_CONNECTOR_UPDATE_REQUIRED']],
 [429,'rate_agent','honor_backoff',['RATE_LIMITED','MAINTENANCE','NO1_BRIDGE_BUSY']],
 [500,'worker_agent','restart_worker',['WORKER_NOT_RUNNING']],
 [502,'upstream_agent','retry_saved_request',['KREAM_SEARCH_FAILED','POIZON_API_ERROR','STOCK_CHECK_FAILED','MUSINSA_BENEFIT_FETCH_FAILED','MUSINSA_RANKING_ERROR','NO1_UPSTREAM_LOOKUP_FAILED','NO1_RANKING_SETTINGS_UNAVAILABLE','NO1_REMOTE_ERROR','ELECTRON_SEND_FAILED','BATCH_NEEDS_ATTENTION','SOURCE_UNAVAILABLE']],
 [503,'connector_agent','wait_for_connector',['NO1_BRIDGE_DISCONNECTED','NO1_CONNECTION_STOPPED','NO_ELECTRON_CONNECTED','ELECTRON_DISCONNECTED','ELECTRON_OFFLINE','RECONNECTING','NO1_RELAY_CLOSED','NO1_RELAY_CONNECTION_FAILED']],
 [503,'bridge_agent','restart_bridge',['NO1_BRIDGE_UNAVAILABLE','NO1_BRIDGE_NOT_CONFIGURED','NO1_BRIDGE_START_FAILED']],
 [503,'remote_bridge_agent','record_remote_bridge_failure',['BRIDGE_HTTP_503','REMOTE_BRIDGE_NOT_RUNNING']],
 [504,'latency_agent','inspect_stall',['TIMEOUT','NO1_RELAY_TIMEOUT','NO1_BRIDGE_TIMEOUT','NO1_HISTORY_TIMEOUT','WORKER_PROGRESS_STALE','CODEX_RPC_TIMEOUT','CODEX_TURN_TIMEOUT','REMOTE_BRIDGE_SIGNAL_STALE']],
];
export const ERROR_CATALOG=Object.freeze(Object.fromEntries(groups.flatMap(([code,handler,action,reasons])=>reasons.map(reason=>[reason,Object.freeze({code,handler,action})]))));
export function errorReason(value){
 const raw=String(value??'').trim();
 const codes=[...raw.matchAll(/(?:^|:\s*)([A-Z][A-Z0-9_]{2,})\b/g)].map(x=>x[1]);
 return codes.findLast(code=>ERROR_CATALOG[code])||codes.at(-1)||raw.slice(0,120)||'UNKNOWN_ERROR';
}
export function classifyError(finding={}){
 const reason=errorReason(finding.reason);
 if(finding.status==='stopped')return {reason:'USER_STOPPED',...ERROR_CATALOG.USER_STOPPED};
 if(finding.status==='worker_stopped')return {reason:'WORKER_NOT_RUNNING',...ERROR_CATALOG.WORKER_NOT_RUNNING};
 if(finding.status==='bridge_unavailable')return {reason:'NO1_BRIDGE_UNAVAILABLE',...ERROR_CATALOG.NO1_BRIDGE_UNAVAILABLE};
 if(finding.status==='stalled')return {reason:'WORKER_PROGRESS_STALE',...ERROR_CATALOG.WORKER_PROGRESS_STALE};
 const known=ERROR_CATALOG[reason];if(known)return {reason,...known};
 return {reason,code:501,handler:'diagnostic_agent',action:'record_unknown_error'};
}
