"""Tagged Korean readings in deterministic Seoul-calendar order for the briefing."""

from datetime import datetime, timedelta, timezone


KST = timezone(timedelta(hours=9))
WIKISOURCE = "https://ko.wikisource.org/wiki/"
AZALEAS = "진달래꽃_(시집)/"
SILENCE = "님의_침묵/"

# Public-domain works, with a source page for each extract. Keep verse lineation
# and keep provenance separate from the passage shown on its card.
READINGS = (
    ("시", "산유화", "김소월", AZALEAS + "산유화",
     "피는 꽃은\n저만치 혼자서 피어 있네", ("자연", "꽃", "고요")),
    ("산문", "그믐달", "나도향", "그믐달_(나도향)",
     "초승달이나 보름달은 보는 이가 많지마는 그믐달은 보는 이가 적어 그만큼 외로운 달이다.",
     ("밤", "고독", "달")),
    ("시", "빼앗긴 들에도 봄은 오는가", "이상화", "빼앗긴_들에도_봄은_오는가",
     "푸른 하늘 푸른 들이 맞붙은 곳으로\n가르마같은 논길을 따라 꿈속을 가듯 걸어만 간다.", ("봄", "들판", "산책")),
    ("시", "엄마야 누나야", "김소월", AZALEAS + "엄마야_누나야",
     "뒷문 밖에는 갈잎의 노래\n엄마야 누나야 강변 살자.", ("가족", "자연", "그리움")),
    ("시", "알 수 없어요", "한용운", SILENCE + "알_수_없어요",
     "바람도 없는 공중에 수직의 파문을 내이며 고요히 떨어지는 오동잎은 누구의 발자취입니까",
     ("가을", "고요", "자연")),
    ("산문", "배따라기", "김동인", "배따라기",
     "담뱃내는 무럭무럭 하늘로 올라간다. 하늘에도 봄이 왔다.", ("봄", "하늘", "일상")),
    ("시", "먼 후일", "김소월", AZALEAS + "먼_후일",
     "오늘도 어제도 아니 잊고\n먼 훗날 그때에 ‘잊었노라’", ("그리움", "기억", "이별")),
    ("시", "청산별곡", "작자 미상", "청산별곡",
     "우러라 우러라 새여 자고 니러 우러라 새여.", ("자연", "고독", "새")),
    ("시", "가는 길", "김소월", AZALEAS + "가는_길",
     "그립다\n말을 할까\n하니 그리워", ("그리움", "망설임", "사랑")),
    ("산문", "빈처", "현진건", "빈처",
     "온 천지가 빈 듯이 고요한데 투닥투닥 떨어지는 빗소리가 한없는 구슬픈 생각을 자아낸다.",
     ("비", "밤", "고요")),
    ("시", "금잔디", "김소월", AZALEAS + "금잔디",
     "봄이 왔네, 봄빛이 왔네\n버드나무 끝에도 실가지에.", ("봄", "자연", "빛")),
    ("시", "님의 침묵", "한용운", SILENCE + "님의_침묵",
     "제 곡조를 못 이기는 사랑의 노래는 임의 침묵을 휩싸고 돕니다.", ("사랑", "이별", "노래")),
    ("시", "예전엔 미처 몰랐어요", "김소월", AZALEAS + "예전엔_미처_몰랐어요",
     "봄 가을없이 밤마다 돋는 달도\n‘예전엔 미처 몰랐어요.’", ("달", "밤", "기억")),
    ("시", "진달래꽃", "김소월", AZALEAS + "진달래꽃",
     "놓인 그 꽃을\n사뿐히 즈려밟고 가시옵소서.", ("꽃", "사랑", "이별")),
)

# The separate daily one-liners keep their own rotation.
LINES = (
    ("오래된 노트를 펼쳤다가 오늘 풀 문제의 실마리를 만났다.", ("기록", "배움")),
    ("할 일이 너무 많은 날에는, 내가 끝낼 수 있는 가장 작은 일부터 적는다.", ("실천", "집중")),
    ("빈 문서에 제목을 붙였다. 이제 돌아올 자리가 생겼다.", ("시작", "창작")),
    ("검토할 때 가장 먼저 다시 읽을 문장은 맨 처음 받은 요청이다.", ("관찰", "협력")),
    ("오늘 배운 걸 내 말로 한 줄 써 보니, 어디서 막혔는지 보였다.", ("기록", "배움")),
    ("서둘러 결론을 내린 자리에 물음표 하나를 남겨 둔다.", ("성찰", "질문")),
    ("누군가 남긴 짧은 인수인계 한 줄이 내일 아침의 첫 시간을 돌려준다.", ("기록", "협력")),
    ("나란히 앉아 같은 화면을 보니 서로 다른 곳에서 막혀 있었다.", ("관찰", "협력")),
    ("다음 사람이 이어 갈 수 있도록, 끝낸 자리 옆에 다음 질문을 적어 뒀다.", ("질문", "협력")),
    ("쉬는 동안 창밖의 빛이 책상 반대편으로 옮겨 갔다.", ("휴식", "관찰")),
    ("컵을 씻고 돌아왔더니 마지막 문장을 고칠 마음이 생겼다.", ("휴식", "창작")),
    ("오늘 한 번 덜어 낸 일 덕분에 남은 일에 눈을 맞출 시간이 났다.", ("집중", "선택")),
    ("계획표 한 칸을 비워 두자 생각보다 반가운 일이 들어왔다.", ("휴식", "선택")),
    ("실마리가 보이지 않던 날에도 처음으로 돌아가 읽는 일은 할 수 있었다.", ("실천", "시작")),
)


def reading_candidates(now=None):
    """Give each kind its own two-week rotation as a tie breaker for personalization."""
    day = (now or datetime.now(KST)).astimezone(KST).date().toordinal()
    reading_index = day % len(READINGS)
    line_index = (day * 5) % len(LINES)
    # The persisted heart category is "quote" for both prose and verse.
    quotes = [
        {"kind": "quote", "genre": genre, "title": title, "author": author, "text": text,
         "sourceUrl": WIKISOURCE + page, "tags": list(tags)}
        for genre, title, author, page, text, tags in READINGS[reading_index:] + READINGS[:reading_index]
    ]
    lines = [{"kind": "line", "text": text, "tags": list(tags)}
             for text, tags in LINES[line_index:] + LINES[:line_index]]
    return quotes, lines


def daily_reading(now=None):
    quotes, lines = reading_candidates(now)
    return {"quote": {key: quotes[0][key] for key in ("text", "author", "sourceUrl")},
            "line": lines[0]["text"]}
