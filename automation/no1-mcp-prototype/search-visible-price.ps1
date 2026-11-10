$ErrorActionPreference='Stop'
$request=$env:NO1_UI_REQUEST | ConvertFrom-Json
$id=[string]$request.kreamId; $model=[string]$request.model
if($id -notmatch '^\d{1,12}$' -or $model -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._/ -]{0,99}$'){throw 'INVALID_REQUEST'}
$mutex=[Threading.Mutex]::new($false,'Local\DotNo1PriceRead')
if(!$mutex.WaitOne(0)){throw 'NO1_UI_BUSY'}
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $expected=Join-Path $env:LOCALAPPDATA 'Programs\no1-center-electron\No1 Seller Center.exe'
  $no1IndexUri=([System.Uri]::new((Join-Path $env:LOCALAPPDATA 'Programs\no1-center-electron\resources\mobileweb\index.html'))).AbsoluteUri
  $processes=@(Get-Process -Name 'No1 Seller Center' -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0 -and $_.Path -eq $expected})
  if($processes.Count -ne 1){throw 'NO1_WINDOW_NOT_UNIQUE_OR_UNAVAILABLE'}
  $root=[System.Windows.Automation.AutomationElement]::FromHandle($processes[0].MainWindowHandle)
  $notices=@($root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | Where-Object {$_.Current.Name -eq '추천인 안내'})
  if($notices.Count -gt 0){throw 'NO1_NOTICE_BLOCKING_QUERY'}
  $wp=$null; if($root.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern,[ref]$wp) -and $wp.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized){throw 'NO1_WINDOW_MINIMIZED'}; if($root.Current.IsOffscreen){throw 'NO1_WINDOW_NOT_VISIBLE'}
function Ensure-No1Screen([string]$target){
 $routes=@{'market'=@('price-comparison','시세 비교');'stock'=@('stock-check','재고 조회')}
 if(!$routes.ContainsKey($target)){throw 'SCREEN_TRANSITION_TARGET_INVALID'}
 $scopeNav=[System.Windows.Automation.TreeScope]::Descendants;$condNav=[System.Windows.Automation.Condition]::TrueCondition
 function Get-No1Route {
  $docs=@($root.FindAll($scopeNav,$condNav) | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document -and $_.Current.AutomationId -eq 'RootWebArea'})
  if($docs.Count -ne 1){throw 'SCREEN_TRANSITION_DOCUMENT_AMBIGUOUS'}
  $val=$null;if(!$docs[0].TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$val)){throw 'SCREEN_TRANSITION_ROUTE_UNAVAILABLE'}
  $url=$val.Current.Value
  if($url -notlike ($no1IndexUri+'#/main/*')){throw 'SCREEN_TRANSITION_UNEXPECTED_ORIGIN'}
  return ($url -split '#/main/')[1]
 }
 $from=Get-No1Route;$expected=$routes[$target][0]
 if($from -eq $expected){return @{from=$from;to=$expected;changed=$false;verified=$true}}
 if($from -notin @('stock-check','price-comparison','seller-integration')){throw 'SCREEN_TRANSITION_UNSUPPORTED_START'}
 $links=@($root.FindAll($scopeNav,$condNav)|Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Hyperlink -and $_.Current.Name -eq $routes[$target][1]})
 if($links.Count -ne 1){throw 'SCREEN_TRANSITION_MENU_AMBIGUOUS'}
 $v=$null;if(!$links[0].TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$v) -or $v.Current.Value -cne ($no1IndexUri+'#/main/'+$expected)){throw 'SCREEN_TRANSITION_MENU_URL_MISMATCH'}
 $ip=$null;if(!$links[0].TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$ip)){throw 'SCREEN_TRANSITION_INVOKE_UNAVAILABLE'}
 try{$ip.Invoke()}catch{throw 'SCREEN_TRANSITION_INVOKE_FAILED'}
 $until=[DateTime]::UtcNow.AddSeconds(5)
 do{Start-Sleep -Milliseconds 100;$actual=Get-No1Route}while($actual -ne $expected -and [DateTime]::UtcNow -lt $until)
 if($actual -ne $expected){throw 'SCREEN_TRANSITION_TIMEOUT'}
 return @{from=$from;to=$actual;changed=$true;verified=$true}
}
  $navigation=Ensure-No1Screen 'market'
  $searchStartedAt=[DateTime]::UtcNow.ToString('o')
  $cond=[System.Windows.Automation.Condition]::TrueCondition
  $scope=[System.Windows.Automation.TreeScope]::Descendants
  if($request.search -eq $true){
    $elements=$root.FindAll($scope,$cond)
    $inputs=@($elements | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $_.Current.Name -eq '크림에서만 검색'})
    $buttons=@($elements | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -eq '크림 조회'})
    if($inputs.Count -ne 1 -or $buttons.Count -ne 1){throw 'SEARCH_CONTROLS_NOT_UNIQUE'}
    $value=$null;$invoke=$null
    if(!$inputs[0].TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$value)){throw 'SEARCH_VALUE_PATTERN_UNAVAILABLE'}
    if(!$buttons[0].TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)){throw 'SEARCH_INVOKE_PATTERN_UNAVAILABLE'}
    $value.SetValue($model)
    $inputDeadline=[DateTime]::UtcNow.AddSeconds(3)
    do {Start-Sleep -Milliseconds 100; $inputValue=$value.Current.Value} while($inputValue -cne $model -and [DateTime]::UtcNow -lt $inputDeadline)
    if($inputValue -cne $model){throw 'SEARCH_INPUT_MISMATCH'}
    $invoke.Invoke()
    $deadline=[DateTime]::UtcNow.AddSeconds(18)
    do{
      Start-Sleep -Milliseconds 300
      $scan=$root.FindAll($scope,$cond)
      $busy=@($scan | Where-Object {$_.Current.Name -eq 'KREAM 검색 중입니다'})
      $ready=@($scan | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -eq '크림 조회' -and $_.Current.IsEnabled})
    }while(($busy.Count -gt 0 -or $ready.Count -ne 1) -and [DateTime]::UtcNow -lt $deadline)
    if($busy.Count -gt 0 -or $ready.Count -ne 1){throw 'SEARCH_TIMEOUT'}
  }
  $all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  $names=@();$idFound=$false;$modelFound=$false;$priceTable=$null
  foreach($el in $all){
    $n=$el.Current.Name.Trim()
    if($n -ceq $model -and $el.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text){$modelFound=$true}
    if($el.Current.ControlType -eq [System.Windows.Automation.ControlType]::Hyperlink){
      $v=$null
      if($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$v)){if($v.Current.Value -ceq ('https://kream.co.kr/products/'+$id)){$idFound=$true}}
    }
    if($el.Current.ControlType -eq [System.Windows.Automation.ControlType]::Table -or $el.Current.ControlType -eq [System.Windows.Automation.ControlType]::DataGrid){
      $children=$el.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
      $labels=@($children | ForEach-Object {$_.Current.Name})
      if($labels -contains '즉시 판매가' -and $labels -contains '30일 예상 거래량'){if($null -ne $priceTable){throw 'AMBIGUOUS_PRICE_TABLE'};$priceTable=$el}
    }
  }
  if(!$idFound -or !$modelFound){throw 'IDENTITY_MISMATCH_OR_NOT_VISIBLE'}
  if($null -eq $priceTable){throw 'PRICE_TABLE_NOT_AVAILABLE'}
  $rows=$priceTable.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
  $sizes=@();$asOf=$null
  foreach($row in $rows){
    $cells=$row.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
    $v=@($cells | ForEach-Object {$_.Current.Name})
    if($v.Count -ge 5 -and $v[0] -notin @('합계','사이즈') -and $v[0].Length -gt 0 -and $v[0].Length -le 40){
      if($v[1] -notmatch '^\d+$'){throw 'VOLUME_UNAVAILABLE'}
      $price=$null
      if($v[4] -match '^[\d,]+원$'){$price=[int]($v[4] -replace '[^0-9]','')}elseif($v[4] -ne '-'){throw 'PRICE_UNAVAILABLE'}
      $sizes+=@{size=$v[0];estimatedTrades30d=[int]$v[1];instantBidKrw=$price}
    }
    foreach($x in $v){if($x -match '오늘 \d{1,2}:\d{2}기준'){$asOf=$x}}
  }
  if($sizes.Count -eq 0){throw 'SIZE_ROWS_NOT_AVAILABLE'}
  @{navigation=$navigation;kreamId=$id;model=$model;searchPerformed=[bool]$request.search;searchStartedAt=$searchStartedAt;volumeLabel='30일 예상 거래량';sizes=$sizes;uiAsOfLabel=$asOf;capturedAt=[DateTime]::UtcNow.ToString('o');source='No1 visible UI Automation price table';identityVerifiedFromVisibleLink=$true} | ConvertTo-Json -Depth 8 -Compress
}catch{ @{error=$_.Exception.Message} | ConvertTo-Json -Compress; exit 1 }
finally{$mutex.ReleaseMutex();$mutex.Dispose()}
