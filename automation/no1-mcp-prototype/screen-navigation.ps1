function Ensure-No1Screen([string]$target){
 $no1IndexUri=([System.Uri]::new((Join-Path $env:LOCALAPPDATA 'Programs\no1-center-electron\resources\mobileweb\index.html'))).AbsoluteUri
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
