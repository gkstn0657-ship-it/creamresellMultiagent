$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $expected=Join-Path $env:LOCALAPPDATA 'Programs\no1-center-electron\No1 Seller Center.exe'
  $processes=@(Get-Process -Name 'No1 Seller Center' -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0 -and $_.Path -eq $expected})
  if($processes.Count -ne 1){throw 'NO1_WINDOW_NOT_UNIQUE_OR_UNAVAILABLE'}
  $root=[System.Windows.Automation.AutomationElement]::FromHandle($processes[0].MainWindowHandle)
  if($root.Current.IsOffscreen){throw 'NO1_WINDOW_NOT_VISIBLE'}
  $all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  $names=@();$idFound=$false;$modelFound=$false;$priceTable=$null
  foreach($el in $all){
    $n=$el.Current.Name.Trim()
    if($n -eq 'MM00313KM0307-P199'){$modelFound=$true}
    if($el.Current.ControlType -eq [System.Windows.Automation.ControlType]::Hyperlink){
      $v=$null
      if($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$v)){if($v.Current.Value -eq 'https://kream.co.kr/products/280933'){$idFound=$true}}
    }
    if($el.Current.ControlType -eq [System.Windows.Automation.ControlType]::Table -or $el.Current.ControlType -eq [System.Windows.Automation.ControlType]::DataGrid){
      $children=$el.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
      $labels=@($children | ForEach-Object {$_.Current.Name})
      if($labels -contains '즉시 판매가' -and $labels -contains '30일 예상 거래량'){if($null -ne $priceTable){throw 'AMBIGUOUS_PRICE_TABLE'};$priceTable=$el}
    }
  }
  if(!$idFound -or !$modelFound){throw 'EXPECTED_PRODUCT_IDENTITY_NOT_VISIBLE'}
  if($null -eq $priceTable){throw 'PRICE_TABLE_NOT_AVAILABLE'}
  $rows=$priceTable.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
  $sizes=@();$asOf=$null
  foreach($row in $rows){
    $cells=$row.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
    $v=@($cells | ForEach-Object {$_.Current.Name})
    if($v.Count -ge 5 -and $v[0] -match '^(XS|S|M|L|XL|XXL)$'){
      if($v[1] -notmatch '^\d+$'){throw 'VOLUME_UNAVAILABLE'}
      $price=$null
      if($v[4] -match '^[\d,]+원$'){$price=[int]($v[4] -replace '[^0-9]','')}elseif($v[4] -ne '-'){throw 'PRICE_UNAVAILABLE'}
      $sizes+=@{size=$v[0];estimatedTrades30d=[int]$v[1];instantBidKrw=$price}
    }
    foreach($x in $v){if($x -match '오늘 \d{1,2}:\d{2}기준'){$asOf=$x}}
  }
  if($sizes.Count -eq 0){throw 'SIZE_ROWS_NOT_AVAILABLE'}
  @{kreamId='280933';model='MM00313KM0307-P199';volumeLabel='30일 예상 거래량';sizes=$sizes;uiAsOfLabel=$asOf;capturedAt=[DateTime]::UtcNow.ToString('o');source='No1 visible UI Automation price table';identityVerifiedFromVisibleLink=$true} | ConvertTo-Json -Depth 8 -Compress
}catch{ @{error=$_.Exception.Message} | ConvertTo-Json -Compress; exit 1 }
