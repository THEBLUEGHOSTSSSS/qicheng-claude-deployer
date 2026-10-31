"""Frozen renderer structure and safety contract; does not claim GUI behavior."""
import re
import subprocess
import unittest
from pathlib import Path
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]

class Tags(HTMLParser):
    def __init__(self, text):
        super().__init__(); self.tags=[]; self.feed(text)
    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))

class RendererContract(unittest.TestCase):
    def test_structure(self):
        html=(ROOT/'src/renderer/index.html').read_text()
        tags=Tags(html).tags
        ids={a.get('id') for _,a in tags}
        self.assertTrue({'provider-name','base-url','api-key','model','auth-type'} <= ids)
        self.assertTrue(any(t=='input' and a.get('id')=='api-key' and a.get('type')=='password' for t,a in tags))
        self.assertTrue(any(t=='meta' and a.get('http-equiv','').lower()=='content-security-policy' for t,a in tags))
        self.assertTrue({'environment','install','connect','verify'} <= {a.get('data-step') for _,a in tags})
        self.assertIn('部署',html)
    def test_offline_and_syntax(self):
        html=(ROOT/'src/renderer/index.html').read_text()
        js=(ROOT/'src/renderer/app.js').read_text()
        for tag,attrs in Tags(html).tags:
            self.assertFalse(any(k.startswith('on') for k in attrs))
            if tag in ('script','link','iframe'): self.assertNotRegex(str(attrs),r'https?://')
        self.assertNotRegex(js,r'\b(?:localStorage|sessionStorage|eval)\s*[.(]')
        self.assertNotRegex(js,r"require\s*\(\s*['\"](?:electron|child_process|fs)['\"]")
        p=subprocess.run(['node','--check',str(ROOT/'src/renderer/app.js')],capture_output=True,text=True)
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertIn('prefers-reduced-motion',(ROOT/'src/renderer/styles.css').read_text())

if __name__ == '__main__': unittest.main()
