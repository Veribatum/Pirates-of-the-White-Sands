from pathlib import Path
import re

SITE='https://piratesofthewhitesands.com'

configs={
 'index.html':{
   'title':'Pirate Events & Living History | Panama City, FL',
   'description':'Pirates of the White Sands brings pirate living history, festivals, parades, charity events and family fun to Panama City, Panama City Beach and the Florida Panhandle.',
   'canonical':SITE+'/',
   'og_title':'Pirates of the White Sands | Panama City & Panama City Beach Pirates',
   'og_description':'Pirate events, living history, festivals, community appearances and family activities in Panama City, Panama City Beach and across the Florida Panhandle.',
   'og_image':SITE+'/logo.png',
   'jsonld':'{"@context":"https://schema.org","@type":"Organization","name":"Pirates of the White Sands","url":"https://piratesofthewhitesands.com/","logo":"https://piratesofthewhitesands.com/logo.png","description":"Pirate living-history and community organization based in Panama City, Florida, appearing at festivals, Renaissance fairs, parades, charity events and family activities across Panama City Beach and the Florida Panhandle.","areaServed":[{"@type":"City","name":"Panama City"},{"@type":"City","name":"Panama City Beach"},{"@type":"AdministrativeArea","name":"Florida Panhandle"}]}'
 },
 'calendar.html':{
   'title':'Pirate Events in Panama City & Panama City Beach',
   'description':'Find upcoming pirate events, festivals and community appearances with Pirates of the White Sands in Panama City, Panama City Beach and the Florida Panhandle.',
   'canonical':SITE+'/calendar.html',
   'og_title':'Pirate Events & Calendar | Pirates of the White Sands',
   'og_description':'Upcoming pirate events, festivals and community appearances in Panama City, Panama City Beach and the Florida Panhandle.',
   'og_image':SITE+'/logo.png',
   'jsonld':'{"@context":"https://schema.org","@type":"CollectionPage","name":"Pirate Events in Panama City and Panama City Beach","url":"https://piratesofthewhitesands.com/calendar.html","description":"Upcoming pirate events, festivals and community appearances from Pirates of the White Sands in Panama City, Panama City Beach and the Florida Panhandle.","isPartOf":{"@type":"WebSite","name":"Pirates of the White Sands","url":"https://piratesofthewhitesands.com/"}}'
 },
 'high-seas.html':{
   'title':'Pirates of the High Seas & Ren Fest | Panama City Beach',
   'description':'Pirates of the High Seas & Renaissance Fest returns to Panama City Beach with pirate mayhem, parades, fireworks, mermaids and Renaissance revelry.',
   'canonical':SITE+'/high-seas.html',
   'og_title':'Pirates of the High Seas & Renaissance Fest | Panama City Beach',
   'og_description':'Three days of pirate and Renaissance festival fun in Panama City Beach, Florida, October 9–11, 2026.',
   'og_image':SITE+'/high-seas.jpg',
   'jsonld':'{"@context":"https://schema.org","@type":"Event","name":"Pirates of the High Seas & Renaissance Fest","startDate":"2026-10-09","endDate":"2026-10-11","eventAttendanceMode":"https://schema.org/OfflineEventAttendanceMode","eventStatus":"https://schema.org/EventScheduled","location":{"@type":"Place","name":"Panama City Beach","address":{"@type":"PostalAddress","addressLocality":"Panama City Beach","addressRegion":"FL","addressCountry":"US"}},"image":["https://piratesofthewhitesands.com/high-seas.jpg"],"description":"Three days of pirate mayhem and Renaissance festival activities in Panama City Beach with parades, fireworks, mermaids, fire performances, treasure and family entertainment.","url":"https://piratesofthewhitesands.com/high-seas.html","isAccessibleForFree":true,"organizer":{"@type":"Organization","name":"Pirates of the White Sands","url":"https://piratesofthewhitesands.com/","logo":"https://piratesofthewhitesands.com/logo.png"}}'
 },
 'get-involved.html':{
   'title':'Join, Volunteer or Book Pirates | Panama City, FL',
   'description':'Join Pirates of the White Sands, volunteer, support the crew or request a pirate appearance in Panama City, Panama City Beach and the Florida Panhandle.',
   'canonical':SITE+'/get-involved.html',
   'og_title':'Get Involved | Pirates of the White Sands',
   'og_description':'Join, volunteer, support the mission or request a pirate appearance in the Panama City and Panama City Beach area.',
   'og_image':SITE+'/Join%20the%20Krew.jpg',
   'jsonld':'{"@context":"https://schema.org","@type":"Organization","name":"Pirates of the White Sands","url":"https://piratesofthewhitesands.com/","logo":"https://piratesofthewhitesands.com/logo.png","areaServed":[{"@type":"City","name":"Panama City"},{"@type":"City","name":"Panama City Beach"},{"@type":"AdministrativeArea","name":"Florida Panhandle"}]}'
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
    block+='<meta property="og:site_name" content="Pirates of the White Sands">\n'
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
