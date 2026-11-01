#!/usr/bin/env python3
"""スプレッドシートの内容を data/content.json（シートを読めないときの控え）に書き出す。"""
import csv
import io
import json
import pathlib
import urllib.parse
import urllib.request

SHEET_ID = '19V2V1viJb56T9SEHa2_kY4-MIb7Ojdo8juRjQgqpk9E'
LIST_TABS = {
    'worries': 'お悩み',
    'genres': 'ジャンル',
    'reasons': '選ばれる理由',
    'stats': '実績',
    'schedule': '体験スケジュール',
    'info': '体験概要',
    'flow': '流れ',
    'voices': '保護者の声',
    'faq': 'よくある質問',
}
OUT = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'content.json'


def fetch(tab):
    url = (f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq'
           f'?tqx=out:csv&headers=1&sheet={urllib.parse.quote(tab)}')
    with urllib.request.urlopen(url, timeout=30) as res:
        if 'text/csv' not in res.headers.get('Content-Type', ''):
            raise RuntimeError(f'{tab}: CSVを取得できません。シートの共有設定を確認してください')
        text = res.read().decode('utf-8')
    rows = [{k.strip(): v.strip() for k, v in row.items() if k.strip()} for row in csv.DictReader(io.StringIO(text))]
    # 未入力の行（チェックボックスだけの行）は控えに残さない
    return [r for r in rows if any(v for k, v in r.items() if k != '表示')]


def main():
    settings = {r['項目']: r['内容'] for r in fetch('基本設定')}
    if not settings.get('ヒーロー見出し'):
        raise RuntimeError('基本設定が読み取れません')
    data = {'settings': settings}
    for key, tab in LIST_TABS.items():
        data[key] = fetch(tab)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
