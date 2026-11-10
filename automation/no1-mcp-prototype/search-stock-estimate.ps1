$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$r=$env:NO1_UI_REQUEST | ConvertFrom-Json
$uri=[uri]$r.productUrl
if($r.productUrl -cnotmatch '^https://www\.musinsa\.com/products/\d+$'){throw 'UNSUPPORTED_PRODUCT_URL'}
$id=$uri.Segments[-1];$mutex=[Threading.Mutex]::new($false,'Local\DotNo1PriceRead');if(!$mutex.WaitOne(0)){throw 'NO1_UI_BUSY'}
try{
 Add-Type -AssemblyName UIAutomationClient;Add-Type -AssemblyName UIAutomationTypes;Add-Type -AssemblyName System.Windows.Forms
 $no1Exe=Join-Path $env:LOCALAPPDATA 'Programs\no1-center-electron\No1 Seller Center.exe'
 $no1IndexUri=([System.Uri]::new((Join-Path $env:LOCALAPPDATA 'Programs\no1-center-electron\resources\mobileweb\index.html'))).AbsoluteUri
 $ps=@(Get-Process -Name 'No1 Seller Center' | Where-Object {$_.MainWindowHandle -ne 0 -and $_.Path -eq $no1Exe})
 if($ps.Count -ne 1){throw 'NO1_WINDOW_UNAVAILABLE'}
 $root=[System.Windows.Automation.AutomationElement]::FromHandle($ps[0].MainWindowHandle)
 $notices=@($root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | Where-Object {$_.Current.Name -eq '추천인 안내'})
 if($notices.Count -gt 0){throw 'NO1_NOTICE_BLOCKING_QUERY'}
 $wp=$null;if($root.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern,[ref]$wp) -and $wp.Current.WindowVisualState -eq 'Minimized'){throw 'NO1_WINDOW_MINIMIZED'}
 $scope=[System.Windows.Automation.TreeScope]::Descendants;$cond=[System.Windows.Automation.Condition]::TrueCondition
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
 $navigation=Ensure-No1Screen 'stock'
 function Scan { @($root.FindAll($scope,$cond)) }
 function Invoke($el){$v=$null;if($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$v)){$v.Invoke();return};if($el.Current.Name -eq '혜택 상세 보기' -and $el.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$v)){$v.Expand();return};throw 'INVOKE_UNAVAILABLE'}
 function One($arr){if(@($arr).Count -ne 1){throw 'CONTROL_OR_IDENTITY_AMBIGUOUS'};return @($arr)[0]}
 $all=Scan
 $input=One @($all | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $_.Current.Name -eq '상품 URL, 상품명, 상품번호 검색'})
 # Clear only the displayed result, not history or account data, so earlier results cannot satisfy this query.
 $marker=-1;for($i=0;$i -lt $all.Count;$i++){if($all[$i].Current.Name -eq '재고 조회 결과'){$marker=$i;break}}
 if($marker -ge 0){$clear=One @($all[($marker+1)..($all.Count-1)] | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -eq '지우기'});Invoke $clear;Start-Sleep -Milliseconds 200}
 $all=Scan;if(@($all | Where-Object {$_.Current.AutomationId -like 'stock-option-group-*'}).Count -gt 0){throw 'PREVIOUS_RESULT_NOT_CLEARED'}
 # Clearing a result can replace the input element. Rebind after the render.
 $input=One @($all | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $_.Current.Name -eq '상품 URL, 상품명, 상품번호 검색'})
 $v=$null;if(!$input.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$v)){throw 'SEARCH_VALUE_UNAVAILABLE'};$v.SetValue($r.productUrl)
 $deadline=[DateTime]::UtcNow.AddSeconds(3);do{Start-Sleep -Milliseconds 100}while($v.Current.Value -cne $r.productUrl -and [DateTime]::UtcNow -lt $deadline)
 if($v.Current.Value -cne $r.productUrl){throw 'SEARCH_INPUT_MISMATCH'}
 $queryStartedAt=[DateTime]::UtcNow.ToString('o');$all=Scan
 Invoke (One @($all | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -eq '조회'}))
 $deadline=[DateTime]::UtcNow.AddSeconds(25)
 do{Start-Sleep -Milliseconds 200;$all=Scan;$tables=@($all | Where-Object {$_.Current.AutomationId -like 'stock-option-group-*'});$ready=@($all | Where-Object {$_.Current.Name -eq '최대혜택가'});$loginNotice=@($all | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and $_.Current.Name -like 'Musinsa에 로그인하시면*최대혜택가*'})}while(($tables.Count -eq 0 -or ($ready.Count -ne 1 -and $loginNotice.Count -ne 1)) -and [DateTime]::UtcNow -lt $deadline)
 if($tables.Count -eq 0 -or ($ready.Count -ne 1 -and $loginNotice.Count -ne 1)){throw 'NEW_STOCK_RESULT_TIMEOUT'}
 $queryCompletedAt=[DateTime]::UtcNow.ToString('o')
 $models=@($all | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and $_.Current.Name -ceq ('품번 '+$r.model)})
 $ids=@($all | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and $_.Current.Name -ceq ('상품번호 '+$id)})
 if($models.Count -ne 1 -or $ids.Count -ne 1){throw 'STOCK_PRODUCT_IDENTITY_MISMATCH'}
 # Copy the result's own URL, never accept the search input as product-link evidence.
 [Windows.Forms.Clipboard]::Clear();Invoke (One @($all | Where-Object {$_.Current.Name -eq '링크 복사' -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button}))
 $deadline=[DateTime]::UtcNow.AddSeconds(3);do{Start-Sleep -Milliseconds 100;$copied=[Windows.Forms.Clipboard]::GetText()}while(!$copied -and [DateTime]::UtcNow -lt $deadline)
 if($copied.Trim() -cne $r.productUrl){throw 'STOCK_RESULT_URL_MISMATCH'}
 $colorNodes=@($all | Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name.StartsWith($r.color+' 브랜드 배송 ')})
 $color=One $colorNodes;$colorIndex=[array]::IndexOf($all,$color)
 $table=$null;for($i=$colorIndex+1;$i -lt $all.Count;$i++){if($all[$i].Current.AutomationId -like 'stock-option-group-*'){$table=$all[$i];break};if($all[$i].Current.ControlType -eq [System.Windows.Automation.ControlType]::Button){break}}
 if($null -eq $table){throw 'COLOR_TABLE_NOT_BOUND'}
 $rows=$table.FindAll([System.Windows.Automation.TreeScope]::Children,$cond);$stockRows=@()
 foreach($row in $rows){$cells=@($row.FindAll([System.Windows.Automation.TreeScope]::Children,$cond));if($cells.Count -eq 2 -and $cells[0].Current.Name -ceq $r.option){$stockRows+=,$cells}}
 if($stockRows.Count -ne 1){throw 'STOCK_OPTION_MISMATCH'}
 $stockText=$stockRows[0][1].Current.Name
 if($stockText -match '^(\d+)개$'){$stock=[int]$Matches[1]}elseif($stockText -eq '품절'){$stock=0}else{throw 'STOCK_QUANTITY_UNKNOWN'}
 $price=$null;$priceKrw=$null;$benefitStatus='available';$conditions=@()
 if($ready.Count -ne 1 -and $loginNotice.Count -eq 1){
   $benefitStatus='login-required';$conditions=@($loginNotice[0].Current.Name)
 }else{
 $priceIndex=-1;for($i=0;$i -lt $all.Count;$i++){if($all[$i].Current.Name -eq '최대혜택가'){$priceIndex=$i;break}}
 $price=$null;for($i=$priceIndex+1;$i -lt [Math]::Min($all.Count,$priceIndex+7);$i++){if($all[$i].Current.Name -match '^[\d,]+원$'){$price=$all[$i].Current.Name;break}}
 if(!$price){throw 'BENEFIT_PRICE_UNAVAILABLE'}
 $detail=@($all | Where-Object {$_.Current.Name -eq '혜택 상세 보기' -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button});if($detail.Count -eq 1){Invoke $detail[0];Start-Sleep -Milliseconds 200}
 $all=Scan;$begin=-1;$end=-1;for($i=0;$i -lt $all.Count;$i++){if($all[$i].Current.Name -eq '1개 구매 기준'){$begin=$i};if($begin -ge 0 -and $all[$i].Current.Name -eq '결제금액 1개'){$end=$i+1;break}}
 if($begin -lt 0 -or $end -lt 0){throw 'BENEFIT_CONDITIONS_UNAVAILABLE'}
 $conditions=@($all[$begin..$end] | Where-Object {$_.Current.ControlType -ne [System.Windows.Automation.ControlType]::Image} | ForEach-Object {$_.Current.Name} | Where-Object {$_})
 $priceKrw=[int]($price -replace '[^0-9]','')
 }
 @{navigation=$navigation;productUrl=$r.productUrl;model=$r.model;color=$r.color;option=$r.option;identityVerified=$true;resultUrlVerifiedFromCopy=$true;previousResultCleared=$true;queryStartedAt=$queryStartedAt;queryCompletedAt=$queryCompletedAt;capturedAt=[DateTime]::UtcNow.ToString('o');maximumBenefitPriceText=$price;maximumBenefitPriceKrw=$priceKrw;benefitStatus=$benefitStatus;stockText=$stockText;stockQuantity=$stock;benefitConditionsVerbatim=$conditions;source='No1 stock lookup UI';dataAsOf=$null;freshness='new UI query completed; upstream data timestamp not displayed'} | ConvertTo-Json -Depth 8 -Compress
}catch{@{error=$_.Exception.Message}|ConvertTo-Json -Compress;exit 1}finally{$mutex.ReleaseMutex();$mutex.Dispose()}
