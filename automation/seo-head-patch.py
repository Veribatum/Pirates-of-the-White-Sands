from pathlib import Path
import re

SITE='https://piratesofthewhitesands.com'

configs={
 'index.html':{
   'title':'Pirates of the White Sands | Pirate Events & Living History in Panama City, FL',
   'description':'Pirates of the White Sands is a Panama City, Florida pirate living-history and community crew appearing at festivals, Renaissance fairs, parades, charity events and family activities across Panama City Beach and the Florida Panhandle.',
   'canonical':SITE+'/',
   'og_title':'Pirates of the White Sands | Panama City & Panama City Beach Pirates',
   'og_description':'Pirate events, living history, festivals, community appearances and family activities in Panama City, Panama City Beach and across the Florida Panhandle.',
   'og_image':SITE+'/logo.png',
   'jsonld':'{"@context":"https://schema.org","@type":"Organization","name":"Pirates of the White Sands","url":"https://piratesofthewhitesands.com/","logo":"https://piratesofthewhitesands.com/logo.png","description":"Pirate living-history and community organization based in Panama City, Florida, appearing at festivals, Renaissance fairs, parades, charity events and family activities across Panama City Beach and the Florida Panhandle.","areaServed":[{"@type":"City","name":"Panama City"},{"@type":"City","name":"Panama City Beach"},{"@type":"AdministrativeArea","name":"Florida Panhandle"}]}'
 },
 'calendar.html':{
   'title':'Pirate Events in Panama City & Panama City Beach | Pirates of the White Sands Calendar',
   'description':'Find upcoming pirate events, festivals, community appearances and family activities with Pirates of the White Sands in Panama City, Panama City Beach and across the Florida Panhandle.',
   'canonical':SITE+'/calendar.html',
   'og_title':'Pirate Events & Calendar | Pirates of the White Sands',
   'og_description':'Upcoming pirate events, festivals and community appearances in Panama City, Panama City Beach and the Florida Panhandle.',
   'og_image':SITE+'/logo.png'
 },
 'high-seas.html':{
   'title':'Pirates of the High Seas & Renaissance Fest | Panama City Beach, FL',
   'description':'Pirates of the High Seas & Renaissance Fest brings pirate mayhem, parades, fireworks, mermaids, performances and Renaissance revelry to Panama City Beach, Florida, October 9–11, 2026.',
   'canonical':SITE+'/high-seas.html',
   'og_title':'Pirates of the High Seas & Renaissance Fest | Panama City Beach',
   'og_description':'Three days of pirate and Renaissance festival fun in Panama City Beach, Florida, October 9–11, 2026.',
   'og_image':SITE+'/high-seas.jpg',
   'jsonld':'{"@context":"https://schema.org","@type":"Event","name":"Pirates of the High Seas & Renaissance Fest","startDate":"2026-10-09","endDate":"2026-10-11","eventAttendanceMode":"https://schema.org/OfflineEventAttendanceMode","eventStatus":"https://schema.org/EventScheduled","location":{"@type":"Place","name":"Panama City Beach","address":{"@type":"PostalAddress","addressLocality":"Panama City Beach","addressRegion":"FL","addressCountry":"US"}},"image":["https://piratesofthewhitesands.com/high-seas.jpg"],"description":"Three days of pirate mayhem and Renaissance festival activities in Panama City Beach with parades, fireworks, mermaids, fire performances, treasure and family entertainment.","url":"https://piratesofthewhitesands.com/high-seas.html","isAccessibleForFree":true,"organizer":{"@type":"Organization","name":"Pirates of the White Sands","url":"https://piratesofthewhitesands.com/"}}'
 }
}

def patch(path,cfg):
    p=Path(path)
    text=p.read_text(encoding='utf-8')
    original=text
    text=re.sub(r'<title>.*?</title>',f'<title>{cfg["title"]}</title>',text,count=1,flags=re.S)
    text=re.sub(r'<meta name="description" content=".*?">',f'<meta name="description" content="{cfg["description"]}">',text,count=1,flags=re.S)
    # Remove only metadata managed by this script so reruns are idempotent.
    text=re.sub(r'\n<!-- POTWS SEO START -->.*?<!-- POTWS SEO END -->\n','\n',text,count=1,flags=re.S)
    block='\n<!-- POTWS SEO START -->\n'
    block+=f'<link rel="canonical" href="{cfg["canonical"]}">\n'
    block+='<meta property="og:type" content="website">\n'
    block+=f'<meta property="og:site_name" content="Pirates of the White Sands">\n'
    block+=f'<meta property="og:title" content="{cfg["og_title"]}">\n'
    block+=f'<meta property="og:description" content="{cfg["og_description"]}">\n'
    block+=f'<meta property="og:url" content="{cfg["canonical"]}">\n'
    block+=f'<meta property="og:image" content="{cfg["og_image"]}">\n'
    block+='<meta name="twitter:card" content="summary_large_image">\n'
    block+=f'<meta name="twitter:title" content="{cfg["og_title"]}">\n'
    block+=f'<meta name="twitter:description" content="{cfg["og_description"]}">\n'
    block+=f'<meta name="twitter:image" content="{cfg["og_image"]}">\n'
    if cfg.get('jsonld'):
        block+=f'<script type="application/ld+json">{cfg["jsonld"]}</script>\n'
    block+='<!-- POTWS SEO END -->\n'
    marker='<style>'
    if marker not in text:
        raise RuntimeError(f'{path}: <style> marker not found')
    text=text.replace(marker,block+marker,1)
    if text!=original:
        p.write_text(text,encoding='utf-8')
        print('updated',path)
    else:
        print('no change',path)

for path,cfg in configs.items():
    patch(path,cfg)
