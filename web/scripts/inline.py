"""Fold the Vite build (one JS + one CSS file) into a single self-contained HTML page for artifact hosting."""
import glob, sys
dist = 'dist/assets/'
js = open(glob.glob(dist + '*.js')[0], encoding='utf-8').read().replace('</script', '<\\/script')
css = open(glob.glob(dist + '*.css')[0], encoding='utf-8').read()
INIT = "(function(){try{var t=null;try{t=localStorage.getItem('rr-theme')}catch(e){}if(t!=='light'&&t!=='dark'){t=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',t);var m=document.querySelector('meta[name=theme-color]');if(m)m.setAttribute('content',t==='dark'?'#000000':'#ffffff')}catch(e){document.documentElement.setAttribute('data-theme','light')}})();"
html = f'''<meta charset="utf-8">
<title>RideRecord</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet">
<meta name="theme-color" content="#ffffff">
<script>{INIT}</script>
<meta name="description" content="Private ownership records for your motorcycle or scooter.">
<style>{css}</style>
<div id="root"></div>
<script type="module">{js}</script>
'''
open(sys.argv[1], 'w', encoding='utf-8').write(html)
print(len(html) // 1024, 'KB')
