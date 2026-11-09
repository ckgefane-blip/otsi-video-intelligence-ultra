"""Reproducible corrections of the ten OTSI VIE HTML pages.
Usage: python -I fix_pages.py <origDir> <outDir>
Every edit is an exact (old -> new) source replacement that must match exactly once (count given otherwise);
each carries a register note used to build CORRECTION_REGISTER.md."""
import json, os, re, sys
ORIG, OUT = sys.argv[1], sys.argv[2]
E = {}  # page prefix -> list of (old, new, note, count)
def fix(page, old, new, note, count=1): E.setdefault(page, []).append((old, new, note, count))

def fixline(page, prefix, new_line, note):
    """Replace the single whole source line that starts with `prefix` (after optional leading space)."""
    src = open(os.path.join(ORIG, [f for f in os.listdir(ORIG) if f.startswith(page)][0]), encoding='utf-8').read()
    hits = [l for l in src.split('\n') if l.lstrip().startswith(prefix)]
    if len(hits) != 1: raise SystemExit(f'{page}: line prefix matched {len(hits)} lines: {prefix!r}')
    fix(page, hits[0], new_line, note)

GLOBAL_NOTE ='Removed the runtime cleanReferenceText() substitution layer; all visible copy is now literal in source (the substitution caused overflow and left sample values).'

# =============================== 01 HOME ===============================
P = '01'
fix(P, r"T(185,508,'MP4, MOV, up to 2GB',22", r"T(185,508,'MP4, MOV, up to 50 GB',22", 'Upload limit wording unified to the Upload page policy text "50 GB" (owner must confirm the real limit).')
fix(P, r"T(1158,164,'17',28,'b c');T(1195,159,'Kevin De Bruyne',24,'b');T(1195,185,'Midfielder • Manchester City',17,'','color:#33a8ff');",
       r"T(1158,164,'—',28,'b c');T(1195,159,'No player selected',24,'b');T(1195,185,'Confirmed players only',17,'','color:#33a8ff');",
       'Hero player card: fictional shirt number, player and club removed.')
fix(P, r"[['spd','Speed','32.4 km/h',196],['ball','Distance','11.2 km',239],['pass','Passes','82',283],['key','Key Passes','7',326],['xa','xA (Exp. Ast)','0.42',370]]",
       r"[['spd','Speed','—',196],['ball','Distance','—',239],['pass','Passes','—',283],['key','Key Passes','—',326],['xa','xA (Exp. Ast)','—',370]]",
       'Hero metrics card: five fictional values (incl. surviving "7") replaced with "—".')
fix(P, r"'5',992,345,46],[1118,417,78,145,'8',1137,388,35],[1782,398,84,166,'22',", r"'',992,345,46],[1118,417,78,145,'',1137,388,35],[1782,398,84,166,'',",
       'Hero illustration detection tags: fictional jersey numbers removed (frames kept as illustration).')
fix(P, r"T(2476,165,'4K',20,'b c','color:#f5b82e');", r"T(2476,165,'—',20,'b c','color:#f5b82e');", 'Featured reel resolution badge: no reel exists, shows "—".')
fix(P, r"T(2025,381,'Kevin De Bruyne',32,'b');T(2025,414,'Creative Passing Highlights',25,'','color:#e3eefb');",
       r"T(2025,381,'No featured reel',32,'b');T(2025,414,'Published reels appear here',25,'','color:#e3eefb');", 'Featured reel: fictional player/title replaced with empty state.')
fix(P, r"T(2454,412,'02:17',22,'sb c');", r"T(2454,412,'—',22,'sb c');", 'Featured reel duration removed.')
fix(P, r"[['Progressive Passes',2024,177],['Key Passes',2216,117],['Assists',2349,88]].forEach(function(c){D(c[1],447,c[2],43,'ch');T(c[1]+c[2]/2,469,c[0],19,'c','color:#cfe0f5')});",
       r"[['No tags',2024,177],['—',2216,117],['—',2349,88]].forEach(function(c){D(c[1],447,c[2],43,'ch');T(c[1]+c[2]/2,469,c[0],19,'c','color:#cfe0f5')});",
       'Featured reel tag chips: sample tags removed; chips kept.')
fix(P, r"T(2060,543,'125K',23);", r"T(2060,543,'—',23);", 'Featured reel view count removed.')
fix(P, r"T(2204,543,'2.4K',23);", r"T(2204,543,'—',23);", 'Featured reel like count removed.')
fix(P, r"[['cam','1,248','Matches Analyzed','+12%',39,413,60,145,172,428,365],['ppl','4,326','Players Tracked','+18%',470,408,499,584,609,855,782],['reel','12,680','Reels Generated','+25%',896,399,917,1000,1027,1270,1195],['doc','892','Reports Created','+14%',1314,401,1339,1422,1444,1689,1615]]",
       r"[['cam','—','Matches Analyzed','',39,413,60,145,172,428,365],['ppl','—','Players Tracked','',470,408,499,584,609,855,782],['reel','—','Reels Generated','',896,399,917,1000,1027,1270,1195],['doc','—','Reports Created','',1314,401,1339,1422,1444,1689,1615]]",
       'Four KPI cards: fictional totals and trends removed.')
fix(P, r"T(s[9],646,'↑+'+s[3].slice(1),19,'sb r','color:#3ee6a8');", r"T(s[9],646,'—',19,'sb r','color:#8ea3bf');", 'KPI trend: fictional "↑+n%" replaced with muted "—".')
fix(P, r"var h=[16,24,34,46,56][j];D(s[10]+j*15,712-h,9,h,'','background:#1e90ff;border-radius:2px')",
       r"var h=4;D(s[10]+j*15,712-h,9,h,'','background:#1e3a66;border-radius:2px')", 'KPI mini bar charts: rising fictional trend flattened to an empty baseline.')
fix(P, r"T(1767,628,'TRUSTED BY PROFESSIONAL CLUBS, AGENCIES & ANALYSTS',17,", r"T(1767,628,'TRUSTED PARTNERS',17,", 'Trust strip heading: unsubstantiated endorsement claim replaced with neutral heading.')
fix(P, r"[['UEFA',1777,101,'i'],['FIFA',1930,82,'b'],['',2070,50,'o'],['LALIGA',2180,94,'b'],['',2320,60,'sq'],['SERIE A',2430,52,'tri']].forEach(",
       r"T(1767,690,'Partner logos appear here once licensing is confirmed',22,'','color:#8ea3bf');[].forEach(",
       'Trust strip: unlicensed third-party marks (UEFA, FIFA, LALIGA, SERIE A + shapes) removed; truthful empty state.')
fix(P, r"T(798,786,'View All',21,'lb r');", r"T(774,786,'View All',21,'lb r');", '"View All" (Recent Matches) no longer collides with its arrow icon (anchor 798→774).')
fix(P, r"T(1776,786,'View All',21,'lb r');", r"T(1752,786,'View All',21,'lb r');", '"View All" (Sample Reels) no longer collides with its arrow icon.')
fix(P, r"T(2498,786,'View All',21,'lb r');", r"T(2474,786,'View All',21,'lb r');", '"View All" (Capabilities) no longer collides with its arrow icon.')
fix(P, r"[['Man City vs Real Madrid','UEFA Champions League  •  Tue, 16 Apr 2024','95:28','2 - 1',855],['Arsenal vs Liverpool','Premier League  •  Sun, 14 Apr 2024','96:14','3 - 2',939],['Barcelona vs Atlético Madrid','La Liga  •  Sat, 13 Apr 2024','94:32','1 - 0',1024],['Bayern Munich vs Dortmund','Bundesliga  •  Sat, 13 Apr 2024','94:35','2 - 2',1110]]",
       r"[['No matches analysed yet','Uploaded matches will be listed here','—','—',855],['—','—','—','—',939],['—','—','—','—',1024],['—','—','—','—',1110]]",
       'Recent Matches: four fictional fixtures/scores/durations replaced by an empty state in row 1 and empty rows 2–4 (row geometry kept).')
fix(P, r"[['Kevin De Bruyne','Progressive Passes','02:17','125K','2.4K',867,'#27487a'],['Vinícius Júnior','Dribbling & 1v1s','01:54','98K','1.7K',1185,'#4a2a30'],['Bukayo Saka','Attacking Runs','02:05','76K','1.3K',1502,'#4a1a28']]",
       r"[['No reels yet','Generated reels appear here','—','—','—',867,'#27487a'],['—','—','—','—','—',1185,'#4a2a30'],['—','—','—','—','—',1502,'#4a1a28']]",
       'Sample Reels: three fictional player reels with durations/views/likes replaced by empty cards.')
fix(P, r"['Kevin De Bruyne','Erling Haaland','Bernardo Silva'].forEach(", r"['Player name','Player name','Player name'].forEach(", 'How It Works illustration: real player names replaced with generic labels.')
fix(P, r"T(1546,y,'MCI',15,'sb c','color:#33a8ff')", r"T(1546,y,'TEAM',13,'sb c','color:#33a8ff')", 'How It Works illustration: club code "MCI" replaced with generic "TEAM".')
fix(P, r"T(2221,1222,'Kevin De Bruyne',15,'sb');T(2221,1243,'Midfielder • MCI',12,", r"T(2221,1222,'Player name',15,'sb');T(2221,1243,'Position • Team',12,", 'How It Works report card: real player/club removed.')
fix(P, r"[['42','Actions',2184],['7.4 km','Distance',2271],['68','Touches',2342]]", r"[['—','Actions',2184],['—','Distance',2271],['—','Touches',2342]]", 'How It Works report card: fictional statistics removed.')
fix(P, r"'(MP4, MOV, up to 2GB).'", r"'(MP4, MOV, up to 50 GB).'", 'How It Works step 1: upload limit wording unified ("50 GB").')

# =============================== 02 UPLOAD ===============================
P = '02'
fix(P, "T(214,153,'(Optionall)',21", "T(214,153,'(Optional)',21", 'Typo "(Optionall)" → "(Optional)".')
fix(P, "SEL(41,211,345,54,'UEFA Champions League');", "SEL(41,211,345,54,'Choose competition',1);", 'Competition select: preset competition removed; muted placeholder.')
fix(P, "SEL(41,308,345,54,'2024/2025');", "SEL(41,308,345,54,'Choose season',1);", 'Season select: previously rendered "Competition not selected" (wrong field); now "Choose season".')
fix(P, "I(477,1217,'chk',16,'#04210f');T(516,1196,'ManCity_vs_RealMadrid.mp4',18,'','color:#cfe0f5');T(516,1223,'1.8 GB \\u2022 100%',18,'','color:#cfe0f5');D(457,1246,282,12,'','background:#1e90ff;border-radius:6px');",
       "T(516,1196,'No file uploaded',18,'','color:#cfe0f5');T(516,1223,'Awaiting upload',18,'','color:#cfe0f5');D(457,1246,282,12,'','background:#12335f;border-radius:6px');",
       'Uploading stage: fictional file/size, completion tick and full (100%) progress bar removed; empty track kept.')
fix(P, "D(464,1204,26,26,'','background:#17c27a;border-radius:50%');", "D(464,1204,26,26,'','background:#26364d;border-radius:50%');", 'Uploading stage: green success dot neutralised (nothing uploaded).')
fix(P, "'2','AI Detection',1,'bars',828,['Detecting players, ball','anatch context...'],'68%',955,1036,864]",
       "'2','AI Detection',0,'bars',828,['Detecting players, ball','and match context...'],'Waiting...',0,1036,864]",
       'AI Detection stage: typo "anatch context..." fixed; fictional 68% progress fill removed; status "Waiting...".')
fix(P, "'4','Indexing',1,'db',1411", "'4','Indexing',0,'db',1411", 'Indexing stage: "active" highlight removed (no job running).')
fix(P, "['Tracking players, ball,','team shapes and events...']", "['Tracking players, ball,','team shapes, events...']", 'Tracking stage copy shortened so it no longer overflows its card (was +9 px).')
fix(P, "['Video ready for analysis','and highlights...']", "['Ready for analysis','and highlights...']", 'Analysis Ready stage copy shortened so it no longer overflows its card (was +15 px).')
fix(P, "[[457,396,'Detecting players...',1,653,852,775,30],[883,299,'Tracking ball...',1,1018,1182,1131,40],[1212,343,'Identifying teams...',0,1364,1555,1483,50],[1585,297,'Generating metadata...',0,1762,1882,1798,60]].forEach(function(l,i){",
       "[[457,396,'Player detection',0,653,852,653,30],[883,299,'Ball tracking',0,1018,1182,1018,40],[1212,343,'Team identification',0,1364,1555,1364,50],[1585,297,'Metadata',0,1762,1882,1762,60]].forEach(function(l,i){",
       'Live Processing Preview: fictional "in progress" labels, completion ticks and progress fills removed.')
fix(P, "if(i==3)D(l[0],1316,l[1],74,'','background:radial-gradient(ellipse at 55% 50%,#ff3a1a 0,#ffd21a 30%,#2fe3a0 55%,#1d6a2a 85%)');else TH(l[0],1316,l[1],74,25+i*12);\n if(i<3){for(var j=0;j<4;j++)D(l[0]+60+j*(l[1]/5),1330,22,34,'','border:2px solid '+(i==2&&j>1?'#f5b82e':'#33a8ff'))}",
       "TH(l[0],1316,l[1],74,25+i*12);",
       'Live Processing Preview: fabricated detection boxes and heat-map thumbnail removed (placeholder frames kept).')
fix(P, "D(l[4],1405,l[6]-l[4],7,'','background:#1e90ff;border-radius:4px')", "", 'Live Processing Preview: zero-length progress fills no longer drawn.')
fix(P, "[['Man City vs Real Madrid','UEFA Champions League','16 Apr 2024','95:28','Completed',251,226,254,282],['Arsenal vs Bayern Munich','UEFA Champions League','9 Apr 2024','92:14','Processing 68%',360,335,363,391],['Barcelona vs PSG','UEFA Champions League','10 Apr 2024','93:11','Completed',471,443,473,502],['Dortmund vs Atl\\u00E9tico Madrid','UEFA Champions League','2 Apr 2024','91:22','Queued',583,557,586,615],['Training Session - Man City','Training','28 Mar 2024','45:10','Failed',697,671,701,729]]",
       "[['No uploads yet','Uploaded videos appear here','—','—','',251,226,254,282],['—','—','','—','',360,335,363,391],['—','—','','—','',471,443,473,502],['—','—','','—','',583,557,586,615],['—','—','','—','',697,671,701,729]]",
       'Recent Uploads: five fictional jobs (titles, competitions, dates, durations, statuses) replaced by an empty state; row geometry kept.')
fix(P, "var st={Completed:['#073a2a','#3ee6a8',2355,127],'Processing 68%':['#0a6ae0','#fff',2349,143],Queued:['#4a3000','#f5b82e',2360,122],Failed:['#4a0f1a','#ff6a6a',2360,122]}[r[4]];\n D(st[2],y-20,st[3],40,'','background:'+st[0]+';border-radius:20px');T(st[2]+st[3]/2,y,r[4],19,'sb c','color:'+st[1]);",
       "",
       'Recent Uploads: fictional status pills (Completed/Processing/Queued/Failed) removed — previously overflowed and collided with kebab icons.')
fix(P, "D(2058,933,22,26,'','background:#fff;clip-path:polygon(0 0,100% 50%,0 100%)');D(2130,983,66,30,'','background:rgba(0,10,25,.8);border-radius:5px');T(2163,998,'95:28',20,'sb c');",
       "D(2058,933,22,26,'','background:#fff;clip-path:polygon(0 0,100% 50%,0 100%)');D(2130,983,66,30,'','background:rgba(0,10,25,.8);border-radius:5px');T(2163,998,'—',20,'sb c');",
       'Selected Item Preview: fictional duration removed.')
fix(P, "T(2222,860,'Man City vs Real Madrid',22,'sb');T(2222,890,'UEFA Champions League',20,'','color:#b9cbe2');T(2222,919,'16 Apr 2024',20,'','color:#b9cbe2');",
       "T(2222,860,'No video selected',22,'sb');T(2222,890,'Select an upload to preview',20,'','color:#b9cbe2');T(2222,919,'—',20,'','color:#b9cbe2');",
       'Selected Item Preview: fictional match/competition/date removed.')
fix(P, "[['clk','File Name','ManCity_vs_RealMadrid.mp4',1056],['fs','File Size','1.8 GB',1097],['asp','Resolution','1920 x 1080 (Full HD)',1139],['asp','Frame Rate','50 fps',1180],['clk','Duration','01:35:28',1222],['meta','Detected Content','Match (High Confidence)',1263]]",
       "[['clk','File Name','No file uploaded',1056],['fs','File Size','—',1097],['asp','Resolution','—',1139],['asp','Frame Rate','—',1180],['clk','Duration','—',1222],['meta','Detected Content','Not classified',1263]]",
       'Selected Item metadata: fictional file name, size, resolution, frame rate, duration and classification removed.')
fix(P, "CREST(2198,1306,38);T(2229,1306,'Man City',20,'','color:#fff');CREST(2336,1306,38);T(2366,1306,'Real Madrid',20,'','color:#fff');",
       "CREST(2198,1306,38);T(2229,1306,'—',20,'','color:#fff');CREST(2336,1306,38);T(2366,1306,'—',20,'','color:#fff');",
       'Teams (Detected): fictional clubs removed — previously two labels overlapped each other and the second crest.')

# =============================== 03 PROCESSING ===============================
P = '03'
fix(P, "T(1635,154,'UEFA Champions League',19,'','color:#b9cbe3');T(1635,190,'Man City vs Real Madrid',25,'b');",
       "T(1635,154,'No processing job',19,'','color:#b9cbe3');T(1635,190,'No video selected',25,'b');", 'Job card: fictional competition/match removed.')
fix(P, "T(1635,231,'Tue, 16 Apr 2024 &nbsp;•&nbsp; 1080p &nbsp;•&nbsp; 95:28',20,'','color:#4db3ff');",
       "T(1635,231,'Upload a video to begin',20,'','color:#4db3ff');", 'Job card: fictional date/resolution/duration removed.')
fix(P, "'⟳ Processing');", "'Idle');", 'Job status pill: fictional "Processing" replaced by "Idle".')
fix(P, "D(2017,215,401,9,'pb','','<i style=\"width:71%\"></i>');T(2446,217,'68%',26,'b');",
       "D(2017,215,401,9,'pb','','<i style=\"width:0%\"></i>');T(2446,217,'—',26,'b');", 'Overall progress: contradictory 71 % bar / "68%" label replaced by empty bar and "—".')
fix(P, """const st=[[109,'1. Detection',['Detect players, ball, referees','and key objects in each frame.'],77,283,100,'Completed',242,121,169],
[500,'2. Tracking',['Track objects across frames','with consistent IDs.'],468,285,100,'Completed',632,122,562],
[862,'3. Identity Resolution',['Assign player identities,','team, and jersey numbers.'],826,287,78,'Processing',988,127,925],
[1268,'4. Event Detection',['Detect passes, shots,','tackles, and key events.'],1233,274,32,'In Queue',1397,110,1332],
[1643,'5. Indexing',['Create searchable metadata,','clips and analytics.'],1606,295,0,'Waiting',1776,125,1707]];""",
"""const st=[[109,'1. Detection',['Detect players, ball, referees','and key objects in each frame.'],77,283,0,'Waiting',242,121,169],
[500,'2. Tracking',['Track objects over time','with consistent IDs.'],468,285,0,'Waiting',632,122,562],
[862,'3. Identity Resolution',['Assign player identities,','team, and jersey numbers.'],826,287,0,'Waiting',988,127,925],
[1268,'4. Event Detection',['Detect passes, shots,','tackles, and key events.'],1233,274,0,'Waiting',1397,110,1332],
[1643,'5. Indexing',['Create searchable metadata,','clips and analytics.'],1606,295,0,'Waiting',1776,125,1707]];""",
       'Five pipeline stages: fictional Completed/Processing/In Queue states and 100/100/78/32 % progress replaced by "Waiting" and empty bars; stage 2 copy shortened so it no longer runs under the → arrow.')
fix(P, "const done=p==100,act=i==2;", "const done=false,act=false;", 'Stage rings: fictional completed/active rings rendered as pending.')
fix(P, "T(bx+1,480,p+'%',24,'');", "T(bx+1,480,'—',24,'');", 'Stage percentages shown as "—".')
fix(P, "D(75,653,415,40,'','background:#0a1a38;border-radius:4px');D(75,653,49,40,'','background:#fff;border-radius:3px');\nT(145,675,'62:17',26,'b');D(233,653,100,40,'b','background:#1580ff;font-size:24px;display:flex;align-items:center;justify-content:center','MCI');T(335,675,'2 &nbsp; 1',24,'b');D(400,653,90,40,'b','background:#1580ff;font-size:24px;display:flex;align-items:center;justify-content:center;border-radius:0 20px 20px 0','RMA');\nT(257,777,'UEFA CHAMPIONS LEAGUE',24,'b','color:#dbe8f8');",
       "D(75,653,415,40,'','background:#0a1a38;border-radius:4px');D(75,653,49,40,'','background:#fff;border-radius:3px');\nT(145,675,'—',26,'b');D(233,653,100,40,'b','background:#1580ff;font-size:24px;display:flex;align-items:center;justify-content:center','—');T(335,675,'—',24,'b');D(400,653,90,40,'b','background:#1580ff;font-size:24px;display:flex;align-items:center;justify-content:center;border-radius:0 20px 20px 0','—');\nT(612,890,'No video loaded — detections appear here during processing',24,'c','color:#cfdcf0');",
       'Processing Preview: fictional scoreboard (62:17, MCI 2–1 RMA) and competition banner removed; empty-state message added inside the frame.')
fix(P, re.search(r"\[\[110,830,57,112,'10 MCI',0\].*?\n.*?\}\);\nD\(373,913,103,30,'tag'.*?\);\nD\(350,1055.*?\);\nD\(470,1010.*?\);\n", open(os.path.join(ORIG, '03_AI_PROCESSING.html'), encoding='utf-8').read(), re.S).group(0), "",
       'Processing Preview: 8 fabricated detection boxes, ID tags (incl. "17 MCI"), ground ring and pass line removed.')
fix(P, "T(228,1177,'62:17 / 95:28',19);", "T(228,1177,'— / —',19);", 'Preview transport: fictional time code removed.')
fix(P, "D(358,1173,472,7,'pb','','<i style=\"width:44%\"></i>');D(557,1167,18,18,'','border-radius:50%;background:#fff');",
       "D(358,1173,472,7,'pb','','<i style=\"width:0%\"></i>');D(358,1167,18,18,'','border-radius:50%;background:#fff');", 'Preview scrubber reset to start (no media).')
fix(P, "tile(1199,553,391,297,'Player Detection','22 players detected',1204,635,379,206,(x,y,w,h)=>{D(x,y,w,h,'ph');D(x+112,y+20,138,186,'bx');D(x+112,y+17,103,30,'tag','background:#0ec2ee;color:#04202c;font-size:24px','17 &nbsp;MCI')});",
       "tile(1199,553,391,297,'Player Detection','Not started',1204,635,379,206,(x,y,w,h)=>{D(x,y,w,h,'ph');T(x+w/2,y+h/2,'No detections yet',19,'c','color:#cfdcf0')});",
       'Player Detection tile: fictional "22 players detected" and box/tag removed; empty state.')
fix(P, "tile(1608,553,373,297,'Ball Detection','1 ball detected',1613,635,359,206,(x,y,w,h)=>{D(x,y,w,h,'ph','background:linear-gradient(135deg,#2a6a3a,#1d4a2a)');D(x+132,y+78,112,100,'bx');D(x+132,y+64,110,30,'tag','background:#0ec2ee;color:#04202c;font-size:21px','Ball &nbsp;0.98')});",
       "tile(1608,553,373,297,'Ball Detection','Not started',1613,635,359,206,(x,y,w,h)=>{D(x,y,w,h,'ph','background:linear-gradient(135deg,#2a6a3a,#1d4a2a)');T(x+w/2,y+h/2,'No detections yet',19,'c','color:#cfdcf0')});",
       'Ball Detection tile: fictional count and "Ball 0.98" confidence removed; empty state.')
fix(P, "tile(1199,860,391,348,'Team Identification','Man City (Blue) vs Real Madrid (White)',1206,947,376,243,(x,y,w,h)=>{D(x,y,w,h,'ph');D(x+34,y+36,125,190,'bx');D(x+230,y+16,125,210,'bx a');D(x+60,y+10,80,30,'tag','background:#0ec2ee;color:#04202c;font-size:22px','MCI');D(x+262,y-4,70,30,'tag','background:#f5b82e;color:#111;font-size:22px','RMA')});",
       "tile(1199,860,391,348,'Team Identification','Not started',1206,947,376,243,(x,y,w,h)=>{D(x,y,w,h,'ph');T(x+w/2,y+h/2,'No teams identified yet',19,'c','color:#cfdcf0')});",
       'Team Identification tile: fictional clubs/kits and boxes removed (also fixes subtitle overlapping the expand icon).')
fix(P, "T(2232,331,'Live',19,'','color:#19e6a0');", "T(2232,331,'Idle',19,'','color:#8ea3bf');", 'Processing Log: "Live" indicator replaced by "Idle".')
fix(P, "D(2214,326,10,10,'','border-radius:50%;background:#19e6a0');", "D(2214,326,10,10,'','border-radius:50%;background:#8ea3bf');", 'Processing Log: live (green) dot neutralised.')
fix(P, re.search(r"const lg=\[\['14:32:18'.*?\n const ly=.*?\nlg\.forEach.*?\n.*?\n.*?\}\);\n|const lg=\[\['14:32:18'.*?T\(2184,ly\[i\],tx,19\.5,'',dim\?'color:#cfdcf0':'color:#dbe8f8'\)\}\);\n", open(os.path.join(ORIG, '03_AI_PROCESSING.html'), encoding='utf-8').read(), re.S).group(0),
       "T(2030,378,'No processing activity yet.',19.5,'','color:#cfdcf0');\n",
       'Processing Log: 15 fictional log lines (incl. "Identified: Kevin De Bruyne") removed; single empty-state line.')
fix(P, "[[2100,72,'#1a8cff','72%','GPU','NVIDIA A100'],[2268,48,'#1a8cff','48%','CPU','32 Cores'],[2438,90,'#19e6c0','1.8<small style=\"font-size:17px;color:#9fb2cc\">/2 TB</small>','Memory','Available']]",
       "[[2100,0,'#1a8cff','—','GPU','Not connected'],[2268,0,'#1a8cff','—','CPU','Not connected'],[2438,0,'#19e6c0','—','Memory','Not connected']]",
       'System Resources: fictional GPU (NVIDIA A100 72 %), CPU (32 cores 48 %) and memory (1.8/2 TB) telemetry removed; rings empty.')
fix(P, " for(let k=0;k<14;k++){const h=8+((k*7+i*5)%20);D(cx-55+k*8,1228-h,5,h,'',`background:${k<9?'#1a8cff':'#2a4a78'}`)}});", "});",
       'System Resources: fabricated utilisation sparklines removed.')
fix(P, "[['0:00',108],['10:00',240],['20:00',378],['30:00',515],['40:00',652],['50:00',788],['60:00',925],['70:00',1140],['80:00',1289],['90:00',1491],['95:28',1591]]",
       "[['0:00',108],['—',1591]]", 'Processing Timeline: fictional 95:28 time axis (with irregular tick spacing) replaced by start/end markers.')
fix(P, "seg(1358,10,[[108,258,'#19e6c0'],[260,525,'#1a8cff'],[527,1083,'#8a5cff'],[1085,1098,'#fff'],[1103,1185,'#1a8cff'],[1187,1306,'#ffb21a'],[1310,1453,'#6b7a92'],[1457,1551,'#ffb21a'],[1553,1632,'#2a3a52']]);\nseg(1373,13,[[108,258,'#19e6c0'],[260,525,'#1a8cff'],[527,1008,'#8a5cff'],[1010,1306,'#ffb21a'],[1310,1453,'#9aa8bd'],[1457,1608,'#2a3a52']]);\nD(1000,1300,3,92,'','background:#fff');D(970,1294,64,28,'','background:#fff;color:#07152b;font-weight:700;font-size:19px;border-radius:4px;display:flex;align-items:center;justify-content:center','62:17');",
       "seg(1358,10,[[108,1632,'#2a3a52']]);\nseg(1373,13,[[108,1608,'#2a3a52']]);",
       'Processing Timeline: fabricated per-stage progress segments and 62:17 playhead removed; two empty lanes kept.')
fix(P, "D(1691,1228,291,182,'box');T(1714,1273,'Output Summary", "D(1691,1228,839,182,'box');T(1714,1273,'Output Summary", 'Output Summary panel widened 291→839 px so it contains its four cards (cards previously spilled outside the panel).')
fix(P, "[[1707,188,'22','Players Tracked'],[1906,184,'1','Ball Tracked'],[2103,223,'342','Events Detected'],[2341,189,'95:28','Processed']]",
       "[[1707,188,'—','Players Tracked'],[1906,184,'—','Ball Tracked'],[2103,223,'—','Events Detected'],[2341,189,'—','Processed']]", 'Output Summary: fictional counts (22 / 1 / 342 / 95:28) removed.')

fix(P, "[[1707,188,'—','Players Tracked'],[1906,184,'—','Ball Tracked'],[2103,223,'—','Events Detected'],[2341,189,'—','Processed']].forEach(([x,w,v,l])=>{D(x,1297,w,113,'box','border-color:#142f55');D(x+14,1335,46,46,'','border:2.5px solid #19a0ff;border-radius:50%');T(x+78,1337,v,26,'b');T(x+78,1369,l,18,'','color:#b3c4dc')});",
       "[[1707,188,'—','Players Tracked'],[1906,184,'—','Ball Tracked'],[2103,223,'—','Events Detected'],[2341,189,'—','Processed']].forEach(([x,w,v,l])=>{D(x,1297,w,113,'box','border-color:#142f55');D(x+14,1335,46,46,'','border:2.5px solid #19a0ff;border-radius:50%');T(x+68,1337,v,26,'b');T(x+68,1369,l,18,'','color:#b3c4dc')});",
       'Output Summary cards: value/label anchor moved 10 px left so "Players Tracked" fits inside its 188 px card (was +11 px overflow).')

# =============================== 04 ANALYSIS ===============================
P = '04'
fixline(P, "T(47,197,'UEFA Champions League'", "T(47,197,'No match selected',22,'b');T(47,227,'—',20,'','color:#cfdcf0');", 'Match card: fictional competition and date removed.')
fixline(P, "D(47,262,48,46,", "D(47,262,48,46,'','border-radius:50%;background:#7ab6ff');T(112,285,'Home team',23,'b');T(350,283,'—',32,'b');", 'Match card: fictional home club and score removed.')
fixline(P, "D(47,324,48,54,", "D(47,324,48,54,'','border-radius:50%;background:#e8d9a0');T(112,351,'Away team',23,'b');T(350,350,'—',32,'b');", 'Match card: fictional away club and score removed.')
fixline(P, "D(37,396,343,98,", "D(37,396,343,98,'','border:1.5px solid #1f8a5a;border-radius:8px;background:#0a2a2a');D(55,412,36,38,'','background:#2a4a78;border-radius:8px');", 'Status card: green success indicator neutralised (no analysis has run).')
fixline(P, "T(107,423,'Processing complete'", "T(107,423,'No analysis available',21,'b','color:#cfe0f5');T(107,447,'Tracking data, events and models',17,'m');T(107,468,'appear after processing completes.',17,'m');",
        'Status card: false "Processing complete … processed successfully." replaced; second line no longer overflows the card (was +15 px).')
fix(P, "[['All Players',1000,22,1],['Man City',1044,11,0],['Real Madrid',1084,11,0]]", "[['All Players',1000,'—',1],['Home team',1044,'—',0],['Away team',1084,'—',0]]", 'Team Filter: fictional clubs and 22/11/11 roster counts removed.')
fixline(P, "D(439,200,441,40,", "D(439,200,441,40,'','background:#0a1a38;border-radius:4px');D(439,200,50,40,'','background:#fff;border-radius:3px');T(509,220,'—',26,'b');D(603,200,92,40,'b','background:#1580ff;font-size:24px;display:flex;align-items:center;justify-content:center','—');T(710,222,'—',24,'b');D(789,200,91,40,'b','background:#1580ff;font-size:24px;display:flex;align-items:center;justify-content:center;border-radius:0 20px 20px 0','—');",
        'Video scoreboard: fictional 62:17 MCI 2–1 RMA removed (scoreboard frame kept).')
fixline(P, "T(1158,345,'mastercard'", "T(1204,512,'No video loaded — select an analysed match to review tracking',26,'c','color:#dbe8f8');", 'Video frame: third-party sponsor marks ("mastercard", "priceless") and competition banner removed; empty-state message added.')
fix(P, "justify-content:center','4K');", "justify-content:center','—');", 'Video resolution badge: fictional "4K" removed.')
fixline(P, "[[628,375,50,72,'11',0]", "[].forEach(([x,y,w,h,n,a])=>{", 'Video frame: 15 fabricated player detection boxes with jersey tags removed.')
fixline(P, "D(1098,612,125,36,", "", 'Video frame: fabricated selected-player ground ring removed.')
fixline(P, "D(1225,596,190,0,", "", 'Video frame: fabricated pass line removed.')
fix(P, "T(652,885,'62:17 / 95:28',22);", "T(652,885,'— / —',22);", 'Transport: fictional time code removed.')
fixline(P, "D(812,882,766,7,", "D(812,882,766,7,'','border-radius:4px;background:#17304f');D(802,874,20,20,'','border-radius:50%;background:#fff');", 'Transport: fictional 64 % scrub position reset to start.')
fix(P, "[['All Events','',432,149,1],['Goals','3',610,135],['Passes','428',762,168],['Key Passes','12',945,177],['Shots','18',1137,143],['Tackles','36',1298,152],['Interceptions','28',1467,174],['Fouls','14',1655,123],['Cards','4',1793,137]]",
       "[['All Events','',432,149,1],['Goals','—',610,135],['Passes','—',762,168],['Key Passes','—',945,177],['Shots','—',1137,143],['Tackles','—',1298,152],['Interceptions','—',1467,204],['Fouls','—',1685,138],['Cards','—',1837,137]]",
       'Event chips: fictional counts removed (nine chips kept); "Interceptions" chip widened 174→204 and "Fouls" 123→138 (Fouls/Cards shifted right into unused row space, Cards now ends at x=1974 inside the panel) so labels are no longer truncated by count badges.')
fix(P, "padding-left:50px':''}\">${n}", "padding-left:44px':''}\">${n}", 'Active event chip: left padding 50→44 px (matches the base chip change).')
fix(P, "font-size:19px;color:#cfdcf0;padding-left:50px}", "font-size:19px;color:#cfdcf0;padding-left:44px}", 'Event chip base style: left padding 50→44 px (icon dot ends at 36 px) to give labels room.')
fix(P, ".chip u{text-decoration:none;position:absolute;right:10px;background:#12294a;border-radius:4px;padding:3px 8px;font-size:17px}",
       ".chip u{text-decoration:none;position:absolute;right:6px;background:#12294a;border-radius:4px;padding:3px 6px;font-size:17px}",
       'Event chips: count badge inset reduced (right 10→6 px, padding 8→6 px) so chip labels ("Key Passes", "Interceptions", "Fouls") are no longer covered.')
fix(P, "[['00:00',636],['15:00',825],['30:00',1017],['45:00',1227],['60:00',1427],['75:00',1663],['90:00',1911]]",
       "[['00:00',650],['15:00',860],['30:00',1070],['45:00',1280],['60:00',1490],['75:00',1700],['90:00',1910]]", 'Timeline scale: irregular tick spacing (189–248 px) corrected to an even 210 px.')
fixline(P, "for(let i=0;i<34;i++)", "T(1200,1180,'No tracks yet — run AI processing to populate presence lanes',18,'c','color:#8ea3bf');", 'Timeline: 34 fabricated event ticks removed; empty-state message added.')
fixline(P, "const rows=[['17','K. De Bruyne'", "const rows=[['—','Player track',0],['—','Player track',0],['—','Player track',0],['—','Player track',0],['—','Player track',0],['—','Player track',0],['—','Player track',0],['','Team Shape (Home)',1],['','Team Shape (Away)',1]];",
        'Tracks & Presence: real player names/numbers removed; nine lanes kept (7 player tracks + 2 team shapes).')
fixline(P, "rows.forEach(([n,nm,a],i)=>{const y=1082+i*24.3;", "rows.forEach(([n,nm,a],i)=>{const y=1082+i*24.3;D(425,y-10,20,20,'cb',i>=7?'border-color:#f5b82e':'','');T(458,y,n,17,'','color:#cfdcf0');T(495,y,nm,18,'','color:#dbe8f8');", 'Tracks & Presence: lane checkboxes unchecked (no tracks exist).')
fixline(P, "for(let k=0;k<9;k++){const x=640+", "});", 'Tracks & Presence: fabricated presence bars removed.')
fixline(P, "D(1499,1010,2,408,", "", 'Timeline: fabricated 62:17 playhead removed.')
fixline(P, "for(let k=0;k<16;k++)D(650+", "});", 'Event Types lanes: fabricated event markers removed (legend kept).')
fix(P, "T(2062,145,'Players (22)',25,", "T(2062,145,'Players (—)',25,", 'Players tab: fictional count removed.')
fix(P, "[['All','22',2034,98,1],['Man City','11',2148,163],['Real Madrid','11',2328,191]]", "[['All','—',2034,98,1],['Home','—',2148,163],['Away','—',2328,191]]",
    'Team chips: fictional clubs/counts removed (also fixes "Man City"/"Real Madrid" colliding with count badges).')
fix(P, "n=='Man City'?'#7ab6ff':'#e8d9a0'", "n=='Home'?'#7ab6ff':'#e8d9a0'", 'Team chip colour mapping updated for neutral labels.')
fixline(P, "[['17','Kevin De Bruyne','98%']", "T(2276,600,'No players detected yet',20,'c','color:#8ea3bf');[].forEach(([n,nm,c],i)=>{const y=370+i*52.7;", 'Players list: ten fictional players with confidence scores and selected row removed; empty state added (column headers kept).')
fixline(P, "D(2157,917,39,32,", "D(2157,917,39,32,'b','background:#1580ff;border-radius:4px;font-size:22px;text-align:center;line-height:32px','—');T(2214,931,'No player selected',26,'b');T(2493,931,'✕',24,'m');", 'Player detail: fictional name and shirt number removed.')
fixline(P, "D(2162,960,32,32,", "D(2162,960,32,32,'','border-radius:50%;background:#7ab6ff');T(2214,973,'Team — &nbsp;|',20,'','color:#cfdcf0');D(2378,962,22,22,'','background:#3a5a88');T(2406,973,'Nationality —',20,'','color:#cfdcf0');", 'Player detail: fictional club, national flag and nationality removed.')
fix(P, "[['Midfielder',2158,105],['Right Foot',2279,104],['Age 32',2399,81]]", "[['Position —',2158,105],['Foot —',2279,104],['Age —',2399,81]]", 'Player detail chips: fictional position/foot/age removed.')
fix(P, "[['Distance','11.4 km','↑ +8%',2029,115],['Top Speed','34.2 km/h','↑ +6%',2155,116],['Passes','68','↑ +18%',2282,115],['Key Passes','6','↑ +200%',2407,115]]",
       "[['Distance','—','',2029,115],['Top Speed','—','',2155,116],['Passes','—','',2282,115],['Key Passes','—','',2407,115]]", 'Player KPI cards: fictional values and deltas removed (also fixes "34.2 km/h" overflowing its card).')
fixline(P, "D(2031,1178,241,188,", "D(2031,1178,241,188,'','background:#1a4a2a;border:2px solid #cfe3d8');T(2151,1272,'No heatmap',18,'c','color:#cfe3d8');", 'Player heatmap: fabricated heat blob replaced with an empty pitch.')
fix(P, "[['Touches','92',1231],['Pass Accuracy','89%',1261],['Chances Created','4',1291],['Shot Assists','3',1323],['Progressive Passes','12',1353]]",
       "[['Touches','—',1231],['Pass Accuracy','—',1261],['Chances Created','—',1291],['Shot Assists','—',1323],['Progressive Passes','—',1353]]", 'Player stats list: fictional values removed.')

# =============================== 05 TACTICAL ===============================
P = '05'
NM = "'color:#cfe3d8'"
fixline(P, "T(40,195,'UEFA Champions League'", "T(40,195,'No match selected',22,'b');T(40,230,'—',20,'','color:#cfdcf0');", 'Match card: fictional competition and date removed.')
fixline(P, "D(44,268,50,50,", "D(44,268,50,50,'','border-radius:50%;background:#7ab6ff');T(110,294,'Home team',24,'b','font-weight:500');T(357,292,'—',32,'b');", 'Match card: fictional home club and score removed.')
fixline(P, "D(44,334,50,58,", "D(44,334,50,58,'','border-radius:50%;background:#e8d9a0');T(110,364,'Away team',24,'','font-weight:500');T(357,362,'—',32,'b');", 'Match card: fictional away club and score removed.')
fixline(P, "D(34,418,356,103,", "D(34,418,356,103,'','border:1.5px solid #1f8a5a;border-radius:8px;background:#0a2a2a');D(52,436,36,40,'','background:#2a4a78;border-radius:8px');", 'Status card: green success indicator neutralised.')
fixline(P, "T(108,445,'Processing complete'", "T(108,445,'No analysis available',21,'b','color:#cfe0f5');T(108,473,'Tracking data, events and models',17,'m');T(108,496,'appear after processing completes.',17,'m');", 'Status card: false "Processing complete" replaced; overflowing line (+9 px) shortened.')
fixline(P, "[['All Players',1050,22],['Man City'", "[['All Players',1050,'—'],['Home team',1100,'—'],['Away team',1148,'—']].forEach(([n,y,c])=>{if(n!='All Players')D(44,y-11,22,22,'','border:2px solid #7fa4d4;border-radius:50%');T(88,y,n,21);D(339,y-15,44,30,'','border:1.5px solid #4a6a96;border-radius:5px;font-size:18px;display:flex;align-items:center;justify-content:center',c)});",
        'Team Filter: fictional clubs and 22/11/11 counts removed.')
fix(P, "SEL(2051,145,236,53,'&nbsp;&nbsp;&nbsp;&nbsp;Manchester City',", "SEL(2051,145,236,53,'&nbsp;&nbsp;&nbsp;&nbsp;Select team',", 'Team selector: fictional club removed.')
fixline(P, "D(447,350,735,433,'box'", "D(447,350,735,433,'box','border-color:#142f55');D(455,360,37,37,'','border-radius:50%;background:#7ab6ff');T(505,378,'No team selected',23,'b');T(849,378,'—',21,'b c');SEL(1049,360,118,37,'—');", 'Team Shape header: fictional club, formation 4-3-3 and 62:17 time removed.')
fixline(P, "o.push('<svg style=\"left:447px;top:404px\"", "T(814,470,'Not measured — requires calibrated tracking data',22,'c','color:#e6f3ea;background:rgba(7,20,42,.78);padding:4px 12px;border-radius:6px');", 'Formation pitch: fabricated shape polygon/lines removed; truthful empty state.')
fixline(P, "[[637,452,24,'GVARDIOL']", "", 'Formation pitch: eleven real player nodes/names removed (also fixes "DE BRUYNE" label crossing the centre line).')
fixline(P, "[['Average Width','32.4 m'", "[['Average Width','—',411,0],['Average Length','—',451,0],['Def. Line Height','—',492,0],['Compactness (DEF)','—',532,0]].forEach(([l,v,y,p])=>{T(1226,y,l,21,'','color:#cfdcf0');D(1410,y-4,150,9,'pb','','<i style=\"width:'+p*100+'%\"></i>');T(1583,y,v,19,'b')});",
        'Team Metrics: fictional metre values and bar fills removed; "Defensive Line Height" shortened to "Def. Line Height" so it no longer overlaps its bar.')
fixline(P, "T(1226,574,'Shape Variability'", "T(1226,574,'Shape Variability',21,'','color:#cfdcf0');D(1410,570,150,9,'pb','','<i style=\"width:0%\"></i>');T(1583,574,'—',19,'b');", 'Shape Variability: fabricated sparkline and "Low" rating replaced by empty bar and "—".')
fixline(P, "D(1206,620,444,160,'box'", "D(1206,620,444,160,'box','border-color:#142f55');T(1226,645,'Formation Stability',22,'','color:#dbe8f8');T(1584,645,'—',24,'b','color:#33a8ff');", 'Formation Stability: fictional 92 % removed.')
fixline(P, "for(let k=0;k<20;k++)D(1226+k*20.1", "for(let k=0;k<20;k++)D(1226+k*20.1,666,18,9,'','background:#17304f');", 'Formation Stability: 14 filled segments emptied.')
fixline(P, "T(1226,710,'Build-up Shape'", "T(1226,710,'Build-up Shape',20,'','color:#cfdcf0');T(1385,710,'—',21,'b');D(1450,703,14,14,'','background:#19e6a0;transform:rotate(45deg)');T(1480,710,'In Possession',19,'','color:#cfdcf0');", 'Build-up shape: fictional 4-2-3-1 removed; phase legend moved 30 px left.')
fixline(P, "T(1226,756,'Defensive Shape'", "T(1226,756,'Defensive Shape',20,'','color:#cfdcf0');T(1385,756,'—',21,'b');D(1450,749,14,14,'','background:#19e6a0;transform:rotate(45deg)');T(1480,756,'Out of Possession',19,'','color:#cfdcf0');", 'Defensive shape: fictional 4-4-2 removed; "Out of Possession" no longer overflows the panel (was +9 px).')
fixline(P, "D(1695,360,350,37,", "D(1695,360,350,37,'','background:#0a1a38;border-radius:4px');D(1695,360,40,37,'','background:#fff;border-radius:3px');T(1752,378,'—',24,'b');D(1826,360,76,37,'b','background:#1580ff;font-size:22px;display:flex;align-items:center;justify-content:center','—');T(1912,378,'—',22,'b');D(1970,360,75,37,'b','background:#1580ff;font-size:22px;display:flex;align-items:center;justify-content:center','—');", 'Video scoreboard: fictional time/score/clubs removed.')
fixline(P, "T(2052,443,'mastercard'", "T(2106,535,'No video loaded',24,'c','color:#dbe8f8');", 'Video frame: third-party sponsor marks removed; empty-state message added.')
fixline(P, "D(2088,632,100,32,", "", 'Video frame: fabricated player ring and pass line removed.')
fixline(P, "T(1702,760,'▶',24);", "T(1702,760,'▶',24);T(1750,760,'▶',44);T(1807,760,'— / —',20);D(1945,757,321,7,'pb','','<i style=\"width:0%\"></i>');D(1945,751,18,18,'','border-radius:50%;background:#fff');SEL(2292,741,73,38,'1x');T(2388,760,'🔊',22);T(2436,760,'⚙',24);T(2486,760,'⛶',24);", 'Video transport: fictional time code and 54 % position removed.')
fixline(P, "D(432,810,650,340,'box');H(432,842,'Pass Network',1);", "D(432,810,650,340,'box');H(432,842,'Pass Network',1);SEL(667,824,191,38,'Select team');SEL(881,824,185,38,'Time range');", 'Pass Network selectors: fictional club and time window removed.')
fixline(P, "o.push('<svg style=\"left:445px;top:879px\"", "T(668,915,'Not measured',22,'c','color:#e6f3ea;background:rgba(7,20,42,.78);padding:4px 12px;border-radius:6px');", 'Pass Network: fabricated pass links removed; empty state.')
fixline(P, "[[667,905,10],[545,935,24]", "", 'Pass Network: fabricated player nodes removed (legend kept).')
fixline(P, "D(1400,822,122,43,", "D(1440,822,122,43,'','background:#0d5ac0;border-radius:6px;font-size:19px;font-weight:600;display:flex;align-items:center;justify-content:center','Heatmap');D(1562,822,240,43,'','border:1.5px solid #17355f;border-radius:0 6px 6px 0;background:#0a1d38');T(1592,844,'Territory',18,'m');T(1709,844,'Final Thirds',18,'m');",
        'Possession panel: Heatmap/Territory/Final Thirds control moved 40 px right so it no longer covers the panel title.')
fixline(P, "D(1126,878,28,28,", "D(1126,878,28,28,'','border-radius:50%;background:#7ab6ff');T(1166,891,'Home team',19,'b');D(1480,878,28,28,'','border-radius:50%;background:#e8d9a0');T(1521,891,'Away team',19,'b');", 'Possession panel: fictional clubs removed.')
fixline(P, "HEAT(1125,912,310,160", "D(1125,912,310,160,'','background:#1d5a2e;border:2px solid #cfe3d8');T(1280,992,'No data',20,'c',"+NM+");D(1480,912,307,160,'','background:#1d5a2e;border:2px solid #cfe3d8');T(1633,992,'No data',20,'c',"+NM+");", 'Heat zones: two fabricated heat maps replaced with empty pitches.')
fixline(P, "T(1122,1096,'Possession'", "T(1122,1096,'Possession',19,'','color:#cfdcf0');T(1122,1121,'—',25,'b','color:#33a8ff');D(1213,1115,220,9,'pb','','<i style=\"width:0%\"></i>');", 'Possession: fictional 58 % (with mismatched 64 % bar) removed.')
fixline(P, "T(1477,1096,'Possession'", "T(1477,1096,'Possession',19,'','color:#cfdcf0');T(1477,1121,'—',25,'b');D(1568,1115,220,9,'pb','','<i style=\"width:0%;background:#fff\"></i>');", 'Possession: fictional 42 % (with mismatched 44 % bar) removed.')
fixline(P, "D(1830,810,702,340,'box')", "D(1830,810,702,340,'box');H(1830,844,'Pressing Map',1);SEL(2107,824,190,38,'Select team');SEL(2322,824,192,38,'All Phases');", 'Pressing selector: fictional club removed.')
fixline(P, "for(let k=0;k<26;k++){const x=1900", "T(2066,915,'Not measured',22,'c','color:#e6f3ea;background:rgba(7,20,42,.78);padding:4px 12px;border-radius:6px');", 'Pressing Map: 26 fabricated pressing events removed; empty state.')
fixline(P, "[['PPDA','8.4'", "[['PPDA','—',1025],['High Press Success','—',1056],['Final Third Regains','—',1088],['Avg Press Height','—',1119]].forEach(([l,v,y])=>{T(2315,y,l,18,'','color:#cfdcf0');T(2514-v.length*10,y,v,18,'b')});", 'Pressing metrics: fictional PPDA/success/regains/height removed.')
fix(P, "SEL(658,1176,234,36,'Kevin De Bruyne (17)');SEL(917,1176,187,36,'60:00 - 75:00');", "SEL(658,1176,234,36,'Select player');SEL(917,1176,187,36,'Time range');", 'Off-Ball Runs selectors: real player and time window removed.')
fixline(P, "o.push('<svg style=\"left:447px;top:1230px\"", "T(677,1262,'Not measured',20,'c','color:#e6f3ea;background:rgba(7,20,42,.78);padding:4px 12px;border-radius:6px');", 'Off-Ball Runs: fabricated run paths removed; empty state.')
fixline(P, "D(668,1315,24,24,", "", 'Off-Ball Runs: fabricated run marker removed.')
fixline(P, "[['Total Off-Ball Runs','12'", "[['Total Off-Ball Runs','—',1256],['Progressive Runs','—',1296],['Runs Into Box','—',1337],['Avg Run Distance','—',1377]].forEach(([l,v,y])=>{T(1163,y,l,19,'','color:#cfdcf0');T(1398-(v.length>2?30:0),y,v,19,'b')});", 'Off-Ball Runs stats: fictional values removed (also fixes "18.3 m" overflowing the stats box).')
fixline(P, "D(1489,1230,133,160,", "D(1489,1230,133,160,'','border-radius:6px;background:linear-gradient(135deg,#5a6f8c,#2a4a78)');T(1638,1244,'Player A',20,'b');T(1660,1277,'No player selected',17,'','color:#cfdcf0');T(1638,1311,'Position —',19,'','color:#cfdcf0');D(1638,1350,46,36,'b','background:#1580ff;border-radius:4px;font-size:22px;text-align:center;line-height:36px','—');", 'Player Comparison A: real player, club and number removed.')
fixline(P, "D(2215,1230,127,160,", "D(2215,1230,127,160,'','border-radius:6px;background:linear-gradient(135deg,#6a5f5a,#3a2a28)');T(2357,1244,'Player B',20,'b');T(2378,1277,'No player selected',17,'','color:#cfdcf0');T(2357,1311,'Position —',19,'','color:#cfdcf0');D(2358,1350,44,36,'b','background:#fff;color:#07152b;border-radius:4px;font-size:22px;text-align:center;line-height:36px','—');", 'Player Comparison B: real player, club and number removed.')
fixline(P, "[['Passes','42','28',1238]", "[['Passes','—','—',1238],['Pass Accuracy','—','—',1270],['Progressive Passes','—','—',1302],['Key Passes','—','—',1334],['Off-Ball Runs','—','—',1366],['Chances Created','—','—',1397]].forEach(([l,a,b,y])=>{T(1846,y,a,18,'b');T(1996,y,l,17,'c','color:#cfdcf0');T(2178,y,b,18,'b');D(2105,y-5,42,10,'','background:#17304f;border-radius:3px')});",
        'Player Comparison metrics: fictional head-to-head values and fixed comparison fills removed.')

# =============================== 06 REEL BUILDER ===============================
P = '06'
fix(P, "D(21,577,397,94,'','background:linear-gradient(90deg,#0b2b57,#08213f);border-radius:8px');", "D(21,392,397,94,'','background:linear-gradient(90deg,#0b2b57,#08213f);border-radius:8px');",
    'Wizard: current-step band moved from step 3 to step 1 (no player is selected, so the workflow is at "Select Player").')
fix(P, "[[1,436,'Select Player','Kevin De Bruyne',1],[2,529,'Choose Moments','12 moments selected',1],[3,621,'Edit & Style','Spotlight, overlays, music',0],[4,714,'Export','Render and share',0]]",
       "[[1,436,'Select Player','No player selected',0],[2,529,'Choose Moments','No moments selected',0],[3,621,'Edit & Style','Spotlight, overlays, music',0],[4,714,'Export','Render and share',0]]",
       'Wizard: false completion ticks on steps 1–2 and fictional player/"12 moments selected" removed.')
fix(P, "s[0]==3?'background:#0a84ff;border-radius:50%'", "s[0]==1?'background:#0a84ff;border-radius:50%'", 'Wizard: active step circle moved to step 1.')
fix(P, "T(40,1069,'Title',19,'m');D(38,1066,363,53,'in');T(51,1096,'Kevin De Bruyne | Masterclass',20);",
       "T(40,1052,'Title',19,'m');D(38,1066,363,53,'in');T(51,1092,'Enter a reel title',20,'','color:#8ea3bf');",
       '"Title" label moved above its input (was 64 % hidden behind the input box); fictional title replaced with placeholder.')
fix(P, "['A cinematic highlight reel featuring','Kevin De Bruyne’s key passes, goals','and defining moments.']", "['Describe this reel (optional)']", 'Description: fictional reel description replaced with placeholder.')
fix(P, "T(51,1187+i*27.5,s,20,'','color:#cfe0f5')", "T(51,1187+i*27.5,s,20,'','color:#8ea3bf')", 'Description placeholder rendered muted.')
fix(P, "T(181,1373,'Epic Cinematic',20);", "T(181,1373,'Choose music',20,'','color:#8ea3bf');", 'Music selector: fictional track removed.')
fix(P, "T(618,170,'Kevin De Bruyne',36,'b');D(896,147,56,42,'','background:#1e90ff;border-radius:6px');T(924,168,'17',26,'b','transform:translate(-50%,-50%)');",
       "T(618,170,'No player selected',36,'b');D(966,147,56,42,'','background:#1e90ff;border-radius:6px');T(994,168,'—',26,'b','transform:translate(-50%,-50%)');",
       'Player header: fictional player/number removed; number badge moved 70 px right so it no longer overlaps the name.')
fix(P, "T(659,214,'Manchester City',22);T(827,214,'|',22,'m');", "T(659,214,'Team —',22);T(827,214,'|',22,'m');", 'Player header: fictional club removed.')
fix(P, "D(856,203,22,22,'','background:linear-gradient(90deg,#111 33%,#f5d000 33% 66%,#d22 66%)');T(891,214,'Belgium',22);",
       "D(856,203,22,22,'','background:#3a5a88');T(891,214,'Nationality —',22);", 'Player header: national flag and nationality removed.')
fix(P, "T(618,256,'Midfielder',22,'','color:#9fb3cc');T(727,256,'|',22,'m');T(745,256,'Right Foot',22,'','color:#9fb3cc');T(849,256,'|',22,'m');T(875,256,'Age 32',22,'','color:#9fb3cc');",
       "T(618,256,'Role —',22,'','color:#9fb3cc');T(727,256,'|',22,'m');T(745,256,'Foot —',22,'','color:#9fb3cc');T(849,256,'|',22,'m');T(875,256,'Age —',22,'','color:#9fb3cc');", 'Player header: fictional role/foot/age removed.')
fix(P, "T(1705,176,'62:17',26,'sb');", "T(1705,176,'—',26,'sb');", 'Scoreboard: fictional match clock removed.')
fix(P, "T(1836,176,'MCI',27,'b','transform:translate(-50%,-50%)');\nT(1885,176,'2',26,'sb');T(1910,176,'1',26,'sb');D(1940,153,72,45,'','background:#1e5bff');T(1976,176,'RMA',27,'b','transform:translate(-50%,-50%)');",
       "T(1836,176,'—',27,'b','transform:translate(-50%,-50%)');\nT(1890,176,'—',26,'sb');D(1940,153,72,45,'','background:#1e5bff');T(1976,176,'—',27,'b','transform:translate(-50%,-50%)');", 'Scoreboard: fictional clubs and 2–1 score removed.')
fix(P, "T(687,820,'00:42 / 03:18',21);", "T(687,820,'— / —',21);", 'Transport: fictional time code removed.')
fix(P, "D(836,815,266,10,'','background:#1e90ff;border-radius:5px');D(1091,809,24,24,", "D(824,809,24,24,", 'Transport: fictional progress fill removed; knob at start.')
fix(P, "T(505,905,'Suggested Key Moments (12)',25,'sb');", "T(505,905,'Suggested Key Moments (0)',25,'sb');", 'Moments header count corrected to 0.')
fix(P, "[[455,300,'Progressive Pass','62:17','00:14',1,1],[776,294,'Key Pass','18:24','00:12',0,2],[1095,295,'Shot on Target','34:10','00:16',0,3],[1413,299,'Assist','48:11','00:13',1,4],[1733,297,'Build-Up Play','55:02','00:15',1,5]]",
       "[[455,300,'No suggestions yet','Run AI processing first','—',0,1],[776,294,'—','—','—',0,2],[1095,295,'—','—','—',0,3],[1413,299,'—','—','—',0,4],[1733,297,'—','—','—',0,5]]",
       'Suggested Key Moments: five fictional moments with match times, durations and selection ticks replaced by empty slots (five card frames kept).')
fix(P, "D(x,i==0?936:939,c[1],i==0?188:185,'',i==0?'background:#06182f;border:3.5px solid #1e90ff;border-radius:10px':'background:#06182f;border:1.5px solid #12335f;border-radius:10px');",
       "D(x,939,c[1],185,'','background:#06182f;border:1.5px solid #12335f;border-radius:10px');", 'Moment card 1 no longer shown as selected.')
fix(P, "T(x+15,1105,c[3]+'  vs Real Madrid',19,'','color:#b9cbe2')", "T(x+15,1105,c[3],19,'','color:#b9cbe2')", 'Moment cards: fictional opponent removed.')
fix(P, "[['00:00',715],['00:30',900],['01:00',1083],['01:30',1280],['02:00',1478],['02:30',1677],['03:00',1878]]", "[['00:00',715],['—',900],['—',1083],['—',1280],['—',1478],['—',1677],['—',1878]]", 'Timeline ruler: fictional 3-minute reel scale removed (empty timeline).')
fix(P, "[[730,176],[1011,156],[1175,136],[1353,217],[1579,192],[1777,251]].forEach(function(c,i){THUMB(c[0],1206,c[1],46,25+i*9);D(c[0],1206,c[1],46,'','border:2px solid '+(i==2?'#1e90ff':'#2a5a98')+';border-radius:5px')});\nD(906,1206,28,48,'','background:#1e90ff;border-radius:6px');D(985,1206,26,48,'','background:#1e90ff;border-radius:6px');",
       "T(1360,1229,'Add moments to build the reel',19,'c','color:#8ea3bf');", 'Video Clips lane: six fictional clips and trim handles removed; empty-lane hint.')
fix(P, "[[721,124],[920,124],[1193,126],[1409,82],[1635,126]].forEach(function(p){D(p[0],1266,p[1],20,'','background:#1e90ff;border-radius:6px')});", "T(1360,1276,'No spotlight effects',17,'c','color:#8ea3bf');", 'Spotlight Effects lane: fictional effect segments removed.')
fix(P, "[[690,502,'Kevin De Bruyne | Masterclass',755,'T'],[1266,368,'Champions League',1342,'ball'],[1708,321,'Generated with OTSI VIE',1773,'T']].forEach(", "T(1360,1319,'No text or overlays',19,'c','color:#8ea3bf');[].forEach(",
    'Text & Overlays lane: fictional title/competition overlays removed.')
fix(P, "for(var i=0;i<150;i++){var h=6+Math.abs(Math.sin(i*1.7)*Math.cos(i*.31))*44*(i>10&&i<145?1:.2);D(940+i*6.8,1378-h/2,3.5,h,'','background:#2fe39a;border-radius:2px')}\nI(720,1378,'note',28);T(748,1378,'Epic Cinematic.mp3',20);",
       "I(720,1378,'note',28);T(748,1378,'No audio selected',20,'','color:#cfe0f5');", 'Audio lane: fictional music file and waveform removed.')
fix(P, "D(997,1176,2,240,'','background:#fff');D(967,1153,64,30,'','background:#fff;border-radius:8px');T(999,1168,'00:42',17,'b','color:#04122a;transform:translate(-50%,-50%)');", "", 'Timeline: fictional 00:42 playhead removed.')
fix(P, "T(2149,738,'Lock on Kevin De Bruyne (17)',20);", "T(2149,738,'Lock on confirmed player',20);", 'Player Targeting: real player removed; lock requires a confirmed identity.')

# =============================== 07 CLIP STUDIO ===============================
P = '07'
fix(P, "T(293,139,'/',36,'b','color:#1e90ff');T(326,139,'Timeline Editor',36,'b');", "T(303,139,'/',36,'b','color:#1e90ff');T(332,139,'Timeline Editor',36,'b');", 'Title: "/" separator moved 10 px right so it no longer touches "Clip Studio".')
fixline(P, "I(60,368,'fold',26,'#cfe0f5');", "I(60,368,'fold',26,'#cfe0f5');[['Folders',102],['All media',196]].forEach(function(b,i){T(b[1],368,b[0],20,'','color:#e3eefb');I(b[1]-14,368,'gt',14,'#8ea3bf')});",
        'Media Bin breadcrumb: fictional club/player/season folders removed (previous labels overlapped each other and their chevrons).')
fixline(P, "[[52,400,184,114],[253,400,180,114]", "T(341,590,'No clips in this folder yet',20,'c','color:#8ea3bf');[].forEach(function(c,i){", 'Media Bin: nine fictional clip thumbnails with durations removed; empty state added.')
fixline(P, "D(46,396,195,122,", "", 'Media Bin: fictional selection frame/tick removed.')
fix(P, "T(1905,246,'4K',22,'b c','color:#f5b82e');", "T(1905,246,'—',22,'b c','color:#f5b82e');", 'Preview: fictional "4K" source badge removed.')
fixline(P, "D(732,610,98,88,", "T(1314,470,'No clip selected',26,'c','color:#dbe8f8');", 'Preview: fictional player overlay card removed; empty-state message added.')
fixline(P, "D(830,610,360,88,", "", 'Preview: fictional player name/number/"Progressive Passes" overlay removed.')
fixline(P, "D(1529,606,371,92,", "", 'Preview: fictional stats overlay panel removed.')
fixline(P, "[['Passes','42',1547]", "", 'Preview: fictional stats (42 / 8 / 0.54) removed.')
fixline(P, "[0,1,2].forEach(function(j){D(1855", "", 'Preview: fictional stats bar glyph removed.')
fix(P, "T(954,783,'00:24.17',24,'');T(1048,783,'/',24,'','color:#8ea3bf');T(1063,783,'01:28.00',24,'','color:#8ea3bf');", "T(954,783,'00:00.00',24,'');T(1048,783,'/',24,'','color:#8ea3bf');T(1063,783,'00:00.00',24,'','color:#8ea3bf');", 'Preview transport: fictional time code replaced with zero.')
fix(P, "D(1180,780,208,6,'','background:#1e90ff;border-radius:3px');D(1377,771,", "D(1169,771,", 'Preview transport: fictional progress removed; knob at start.')
fix(P, "T(2178,375,'01:24',17,'sb c');", "T(2178,375,'—',17,'sb c');", 'Inspector: fictional clip duration removed.')
fix(P, "T(2226,303,'de_bruyne_pass_001.mp4',20,'sb');T(2226,337,'00:14  \\u2022  4K  \\u2022  60fps  \\u2022  MP4',20,'','color:#b9cbe2');T(2226,371,'Added 16 Apr 2024, 14:32',20,'','color:#b9cbe2');",
       "T(2226,303,'No clip selected',20,'sb');T(2226,337,'Select a clip in the Media Bin',20,'','color:#b9cbe2');T(2226,371,'—',20,'','color:#b9cbe2');", 'Inspector: fictional file name, technical line and added date removed.')
fix(P, "T(2229,471,'Kevin De Bruyne',20,'','color:#e3eefb');", "T(2229,471,'Not assigned',20,'','color:#8ea3bf');", 'Inspector Player: real player removed.')
fix(P, "T(2229,524,'Man City vs Real Madrid',20,'','color:#e3eefb');", "T(2229,524,'Not assigned',20,'','color:#8ea3bf');", 'Inspector Match: fictional match removed.')
fix(P, "T(2227,577,'Progressive Pass',20,'','color:#e3eefb');", "T(2227,577,'Not assigned',20,'','color:#8ea3bf');", 'Inspector Event Type: fictional event removed.')
fix(P, "T(2189,631,'62:17  (2nd Half)',20,'','color:#e3eefb');", "T(2189,631,'—',20,'','color:#8ea3bf');", 'Inspector Timestamp: fictional match time removed.')
fix(P, "[['Pass',2174,62],['Progressive',2246,111],['Build-up',2368,93]].forEach(", "T(2176,682,'No tags',19,'','color:#8ea3bf');[].forEach(", 'Inspector Tags: fictional tags removed (add button kept).')
fix(P, "T(2190,737,'Excellent vision and weight on the pass.',20,'','color:#e3eefb');T(2190,765,'Leads to scoring opportunity.',20,'','color:#e3eefb');", "T(2190,737,'Add clip notes',20,'','color:#8ea3bf');", 'Inspector Notes: fictional notes replaced with placeholder.')
fix(P, "T(42,937,'00:24.17',32,'b lb');T(42,972,'01:28.00',20,'m');", "T(42,937,'00:00.00',32,'b lb');T(42,972,'00:00.00',20,'m');", 'Timeline timecode: fictional position/length replaced with zero.')
fix(P, "[['00:00',335],['00:10',568],['00:20',809],['00:30',1055],['00:40',1296],['00:50',1533],['01:00',1780],['01:10',2022],['01:20',2265]]", "[['00:00',357],['—',568],['—',809],['—',1055],['—',1296],['—',1533],['—',1780],['—',2022],['—',2265]]", 'Timeline ruler: fictional sequence scale removed; "00:00" label nudged 22 px right so the playhead handle at 00:00 does not cover it.')
fix(P, "D(335,958,2199,42,'','background:repeating-linear-gradient(90deg,#27487a 0 60px,#2d6a3a 60px 120px,#1d4a8a 120px 180px);opacity:.75');", "D(335,958,2199,42,'','background:#0a1d38;opacity:.75');", 'Timeline overview strip: fictional filmstrip replaced with empty strip.')
fix(P, "[['Video Clips','7',1027],['Transitions','6',1074],['Graphics & Overlays','5',1121],['Lower Thirds','3',1168],['Captions','3',1215],['Statistics','4',1266],['Soundtrack','2',1320],['Audio FX','3',1372]]",
       "[['Video Clips','0',1027],['Transitions','0',1074],['Graphics & Overlays','0',1121],['Lower Thirds','0',1168],['Captions','0',1215],['Statistics','0',1266],['Soundtrack','0',1320],['Audio FX','0',1372]]", 'Track headers: fictional item counts replaced with 0 (eight tracks kept).')
fix(P, "T(128,r[2],r[0],20,'','color:#e3eefb');D(289,r[2]-16,32,32,", "T(128,r[2],r[0],18,'','color:#e3eefb');D(289,r[2]-16,32,32,", 'Track header labels 20→18 px so "Graphics & Overlays" no longer runs under its count badge.')
fixline(P, "[[343,160],[915,130],[1332,206],[1786,294]]", "[1027,1074,1121,1168,1215,1266,1320,1372].forEach(function(y,i){D(343,y-20,2128,40,'','background:#07162c;border:1.5px solid #12335f;border-radius:6px')});T(1407,1027,'Drag clips from the Media Bin to start editing',19,'c','color:#8ea3bf');",
        'Timeline: all fictional clips removed; eight empty lane guides (one per track) and an empty-state hint added so the lane structure stays visible.')
fixline(P, "D(509,1005,398,45,", "", 'Timeline: fictional selected clip "de_bruyne_pass_001.mp4" removed.')
fixline(P, "[['build_up_02.mp4',1050,275]", "", 'Timeline: fictional media files removed.')
fixline(P, "[['Fade',637,146]", "", 'Transitions lane: fictional transitions removed.')
fixline(P, "[['Spotlight Circle',397,488,'user']", "", 'Graphics lane: fictional graphics removed.')
fixline(P, "WAVE(1300,1121,105,26", "", 'Graphics lane: fictional waveform removed.')
fixline(P, "[['Player ID Lower Third',563,402,'gfx']", "", 'Lower Thirds lane: fictional items removed.')
fixline(P, "[['K. De Bruyne plays a progressive pass...'", "", 'Captions lane: fictional captions (incl. real player name) removed.')
fixline(P, "[['Pass Distance (7.4 km)',516,449]", "", 'Statistics lane: fictional stats (7.4 km, xA 0.54) removed.')
fixline(P, "D(343,1298,2191,45,", "", 'Soundtrack lane: fictional music file and waveform removed.')
fixline(P, "[['Crowd',351,452]", "", 'Audio FX lane: fictional sound effects and waveforms removed.')
fixline(P, "D(1002,935,2,480,", "D(335,935,2,480,'','background:#33a8ff;box-shadow:0 0 8px #33a8ff');D(321,922,30,28,'','background:#1e90ff;border-radius:6px');I(336,936,'chev',16,'#fff');", 'Playhead moved to 00:00.')

# =============================== 08 PLAYER REPORT ===============================
P = '08'
BK = "'color:#e6f3ea;background:rgba(7,20,42,.78);padding:4px 12px;border-radius:6px'"
fixline(P, "T(405,290,'17',260,", "", 'Hero: giant fictional shirt-number watermark removed.')
fixline(P, "D(929,197,78,61,", "D(929,197,78,61,'','background:#1e90ff;border-radius:6px');T(968,228,'—',44,'b c');T(1035,224,'No player selected',58,'b');", 'Hero: fictional player name and number removed.')
fixline(P, "T(1035,276,'Midfielder',22,'lb');", "T(1035,276,'Position —',22,'lb');[['—',1166,56],['—',1228,55],['—',1290,57]].forEach(function(c){D(c[1],265,c[2],28,'ch');T(c[1]+c[2]/2,279,c[0],17,'c','color:#9fc8f5')});", 'Hero: fictional position and MC/AM/RW codes removed (three chips kept).')
fixline(P, "D(935,308,60,58,", "D(935,308,60,58,'','background:radial-gradient(circle,#f2c56b 0,#6cc4ff 45%,#fff 50%);border-radius:50%');T(1015,338,'Team —',24);D(1213,320,2,36,'','background:#2a4a75');", 'Hero: fictional club removed.')
fixline(P, "D(1241,318,58,39,", "D(1241,318,58,39,'','background:#3a5a88;border-radius:4px');T(1314,338,'Nationality —',24);", 'Hero: national flag and nationality removed.')
fix(P, "[['Age','32',963],['Height','181 cm',1082],['Weight','70 kg',1242],['Preferred Foot','Right',1410]]", "[['Age','—',963],['Height','—',1082],['Weight','—',1242],['Preferred Foot','—',1410]]", 'Hero bio: fictional age/height (181 cm)/weight (70 kg)/foot removed.')
fix(P, "RING(1677,335,78,16,.98);T(1677,335,'98%',36,'b c');", "RING(1677,335,78,16,0);T(1677,335,'—',36,'b c');", 'Tracking Confidence: fictional 98 % ring removed.')
fixline(P, "D(1767,280,80,35,", "D(1767,280,122,35,'','background:#1a2840;border:1.5px solid #4a5a78;border-radius:6px');D(1779,293,11,11,'','background:#8ea3bf;border-radius:50%');T(1798,298,'Unverified',18,'sb','color:#dfe8f5');",
        'Tracking Confidence pill: green "High"/success styling replaced by neutral "Unverified"; pill widened 80→122 px so the label fits (was +35 px overflow).')
fix(P, "T(1749,395,'Excellent tracking quality',17,'m');T(1749,421,'across 528+ minutes',17,'m');", "T(1749,395,'No tracking data',17,'m');T(1749,421,'for this player yet',17,'m');", 'Tracking Confidence: fictional "Excellent … 528+ minutes" removed.')
fix(P, "T(1987,268,'Advanced Midfielder (Right Half-Space)',24,'sb');", "T(1987,268,'Role not assessed',24,'sb');", 'Role summary: fictional role removed.')
fix(P, "['Operates between the lines, linking play and creating','chances. High involvement in build-up with frequent','progressive carries and final third actions.']", "['An analyst-approved role summary appears here.']", 'Role summary: fictional description removed.')
fix(P, "[['Playmaker',1988,122,384],['Chance Creator',2121,156,384],['Progressive Passer',2288,168,384],['Set Piece Specialist',1988,190,428],['Final Third Threat',2196,183,428]].forEach(", "T(1988,401,'No traits recorded',17,'','color:#8ea3bf');[].forEach(", 'Role summary: five fictional trait chips removed.')
fix(P, "[['Match Minutes',388,247,'95:28','92% of match','clock',0],['Distance (Est.)',647,247,'11.4 km','+8%','run',1],['Top Speed',907,238,'34.2 km/h','+6%','dbl',1],['Sprints',1157,205,'32','+23%','dbl',1],['Passes',1374,234,'68','92% acc.','ball',0],['Key Passes',1621,222,'6','+50%','key',1],['Shots',1856,220,'4','+100%','tgt',1],['xG',2089,217,'0.42','+0.18','bars',1],['xA',2319,219,'0.68','+0.31','share',1]]",
       "[['Match Minutes',388,247,'—','—','clock',0],['Distance (Est.)',647,247,'—','—','run',0],['Top Speed',907,238,'—','—','dbl',0],['Sprints',1157,205,'—','—','dbl',0],['Passes',1374,234,'—','—','ball',0],['Key Passes',1621,222,'—','—','key',0],['Shots',1856,220,'—','—','tgt',0],['xG',2089,217,'—','—','bars',0],['xA',2319,219,'—','—','share',0]]",
       'Nine KPI cards kept; all fictional values and deltas (incl. surviving "6", "4", "↑ +8%", "92% of match") removed — deltas previously collided with the mini charts.')
fix(P, "var h=[24,38,56,72][j]*(i%3==1?.9:1);D(k[1]+k[2]-62+j*14,630-h,8,h,'','background:#1e90ff;border-radius:2px')", "var h=4;D(k[1]+k[2]-62+j*14,630-h,8,h,'','background:#1e3a66;border-radius:2px')", 'KPI mini charts: fictional rising bars flattened to an empty baseline.')
fixline(P, "[[790,820,110,'#ff2a1a']", "T(736,760,'No heatmap data',20,'c',"+BK+");", 'Heatmap: eleven fabricated heat blobs removed; empty state.')
fixline(P, "[['6:12','Pass','Forward pass to Foden'", "T(1438,880,'No events recorded for this player',19,'c','color:#8ea3bf');[].forEach(function(e,i){", 'Event Timeline: ten fictional events (times, descriptions naming real players, clips) removed; empty state.')
fixline(P, "for(var i=0;i<46;i++){var px=", "T(2168,760,'Not measured',20,'c',"+BK+");", 'Action Map: 46 fabricated actions and 23 pass lines removed (lines previously spilled outside the pitch).')
fixline(P, "I(2412,765,'star',26,", "", 'Action Map: fabricated goal marker removed.')
fix(P, "SEL(463,1118,373,39,'vs. Midfielders (UCL 23/24)',17);", "SEL(463,1118,373,39,'Select comparison group',17);", 'Comparison selector: fictional cohort removed.')
fix(P, "[['Progressive Passes (p90)',313,'9.8',91,'5.1',1195],['Key Passes (p90)',242,'3.2',38,'1.4',1229],['xA (p90)',313,'0.68',51,'0.22',1263],['Shot Creating Actions (p90)',221,'5.4',49,'2.8',1298],['Progressive Carries (p90)',219,'4.1',48,'2.1',1332]]",
       "[['Progressive Passes (p90)',0,'—',0,'—',1195],['Key Passes (p90)',0,'—',0,'—',1229],['xA (p90)',0,'—',0,'—',1263],['Shot Creating Actions (p90)',0,'—',0,'—',1298],['Progressive Carries (p90)',0,'—',0,'—',1332]]",
       'Comparison: fictional per-90 values and bar lengths removed (bars still encoded sample values before).')
fix(P, "D(276,y-8,c[1],16,'','background:#0a95ff;border-radius:3px');", "", 'Comparison: zero-length player bars not drawn.')
fix(P, "D(684,y-8,c[3],16,'','background:#4d6482;border-radius:3px');", "", 'Comparison: zero-length cohort bars not drawn.')
fix(P, "T(88,1377,'Kevin De Bruyne',16,'','color:#cfe0f5');", "T(88,1377,'Selected player',16,'','color:#cfe0f5');", 'Comparison legend: real player removed.')
fix(P, "[['trend','High Creative Influence',1163,61,['De Bruyne recorded 6 key passes per 90 minutes, 129% above','the competition average for midfielders. Consistently involved','in chance creation.'],'#3ee6a8'],['pick','Progressive Ball Carrier',1230,48,['8.1 progressive carries per 90, positioning him in the top 5%.','Frequently breaks defensive lines with controlled carries.'],'#33a8ff'],['tgt','Right Half-Space Specialist',1285,52,['62% of attacking actions originate from the right half-space.','Most effective when receiving between lines.'],'#8a6cff'],['shld','Set Piece Threat',1344,53,['3 shots and 4 key passes from set pieces in this match. Remains','a major weapon in dead-ball situations.'],'#f5b82e']]",
       "[['trend','No insights yet',1163,61,['AI insights are generated after analysis','and require analyst review before display.'],'#3ee6a8'],['pick','—',1230,48,[],'#33a8ff'],['tgt','—',1285,52,[],'#8a6cff'],['shld','—',1344,53,[],'#f5b82e']]",
       'Generated Insights: four fictional AI insights with invented statistics removed; four card frames kept with an empty state.')
fix(P, "RING(1920,1275,72,13,.92);T(1920,1268,'9.2',42,'b c');", "RING(1920,1275,72,13,0);T(1920,1268,'—',42,'b c');", 'Scouting: fictional 9.2/10 rating removed.')
fix(P, "[['Elite passing and vision',2083,1191],['Controls tempo and space',2083,1221],['High chance creation output',2083,1251],['Effective in final third',2315,1191],['Leadership and experience',2315,1221]].forEach(", "T(2287,1226,'No scouting assessment yet',17,'c','color:#8ea3bf');[].forEach(",
    'Scouting: five fictional strengths with success ticks removed (also fixes "Leadership and experience" overflowing its box).')
fix(P, "T(2080,1306,'“',48,'b lb');", "", 'Scouting: decorative quote mark removed (it overlapped the quote text and there is no quote).')
fix(P, "['Still one of the most intelligent and effective midfielders','in world football. Unique combination of vision, technique','and decision making.']", "['No scout notes recorded.']", 'Scouting: fictional scout quote removed.')
fix(P, "T(2500,1373,'OTSI VIE Scout Analysis',16,'r m','font-style:italic');", "T(2500,1373,'Awaiting verified scouting data',16,'r m','font-style:italic');", 'Scouting footer: attribution replaced with truthful status.')

fix(P, "I(1763,155,'doc',28,'#fff','#fff');T(1792,155,'Add to Scouting Dossier',21,'sb');", "I(1751,155,'doc',28,'#fff','#fff');T(1778,155,'Add to Scouting Dossier',21,'sb');", '"Add to Scouting Dossier" icon/label moved 12–14 px left so the label no longer touches the button edge.')
fix(P, """<circle cx="'+r+'" cy="'+r+'" r="'+(r-w/2)+'" fill="none" stroke="#0a84ff" stroke-width="'+w+'" stroke-linecap="round" stroke-dasharray="'+c*pct+' '+c+'" transform="rotate(-90 '+r+' '+r+')"/>""", """'+(pct>0?'<circle cx="'+r+'" cy="'+r+'" r="'+(r-w/2)+'" fill="none" stroke="#0a84ff" stroke-width="'+w+'" stroke-linecap="round" stroke-dasharray="'+c*pct+' '+c+'" transform="rotate(-90 '+r+' '+r+')"/>':'')+'""", 'Ring gauge: no arc (and no stray round-cap dot) is drawn when the value is empty.')

# =============================== 09 LIBRARY ===============================
P = '09'
fixline(P, "T(39,201,'UEFA Champions League'", "T(39,201,'No match selected',22,'b');T(39,234,'—',21,'m');", 'Match card: fictional competition and date removed.')
fixline(P, "CREST(66,299,48);", "CREST(66,299,48);T(109,301,'Home team',24);T(363,300,'—',32,'sb c');CREST(66,370,48);T(109,370,'Away team',24);T(363,370,'—',32,'sb c');", 'Match card: fictional clubs and 2–1 score removed.')
fixline(P, "D(35,421,352,96,", "D(35,421,352,96,'','background:#052a28;border:1.5px solid #14705a;border-radius:10px');I(70,455,'shield',38,'#8ea3bf','#2a4a78');", 'Status card: green success shield neutralised.')
fixline(P, "T(106,447,'Processing complete'", "T(106,447,'No analysis available',22,'sb','color:#cfe0f5');T(106,474,'Tracking data, events and models',16,'','color:#b9cbe2');T(106,494,'appear after processing completes.',16,'','color:#b9cbe2');", 'Status card: false "Processing complete … processed successfully." replaced.')
fix(P, "T(84,1025,'All Players',21);D(337,1010,43,30,'ch');T(358,1026,'22',19,'c');", "T(84,1025,'All Players',21);D(337,1010,43,30,'ch');T(358,1026,'—',19,'c');", 'Team Filter: fictional count 22 removed.')
fix(P, "[['Man City',1071],['Real Madrid',1114]].forEach(function(o){I(52,o[1],'xc',26,'#8ea3bf');T(84,o[1],o[0],21,'','color:#d6e4f7');D(337,o[1]-15,43,30,'in');T(358,o[1],'11',19,'c','color:#cfe0f5')});",
       "[['Home team',1071],['Away team',1114]].forEach(function(o){I(52,o[1],'xc',26,'#8ea3bf');T(84,o[1],o[0],21,'','color:#d6e4f7');D(337,o[1]-15,43,30,'in');T(358,o[1],'—',19,'c','color:#cfe0f5')});", 'Team Filter: fictional clubs and 11/11 counts removed.')
fix(P, "[['grid','All Assets',454,482,'284',590,42,1],['grid','Reels',687,714,'96',770,32,0],['doc','Reports',852,881,'48',960,34,0],['ball','Matches',1048,1079,'32',1158,36,0],['fold','Folders',1247,1278,'41',1347,34,0],['dl','Exports',1441,1467,'67',1548,34,0],['user','Shared With Me',1631,1659,'',0,0,0],['tmpl','Templates',1817,1843,'8',1936,26,0]]",
       "[['grid','All Assets',454,482,'0',590,42,1],['grid','Reels',687,714,'0',770,32,0],['doc','Reports',852,881,'0',960,34,0],['ball','Matches',1048,1079,'0',1170,36,0],['fold','Folders',1247,1278,'0',1364,34,0],['dl','Exports',1441,1467,'0',1548,34,0],['user','Shared With Me',1617,1645,'',0,0,0],['tmpl','Templates',1821,1847,'0',1948,24,0]]",
       'Asset tabs: fictional counts (284/96/48/32/41/67/8) replaced with 0; count chips for Matches (+12 px) and Folders (+17 px) moved clear of their labels; "Shared With Me" moved 14 px left and Templates re-spaced so labels no longer collide with the neighbouring icon/chip.')
fix(P, "[['Type','All Types',883,167],['Competition','All Competitions',1061,176],", "[['Type','All Types',883,142],['Competition','All Competitions',1036,201],",
    'Filters: Type select narrowed 167→142 px and Competition widened 176→201 px (same row extent) so "All Competitions" no longer runs under its chevron.')
fix(P, "T(f[2]+20,370,f[1],20,'','color:#e3eefb');", "T(f[2]+20,370,f[1],f[0]=='Competition'?19:20,'','color:#e3eefb');", 'Filters: Competition value set at 19 px to clear its chevron.')
fixline(P, "[['De Bruyne Analysis',578,221,'srch']", "T(578,438,'No saved searches yet',19,'','color:#8ea3bf');", 'Saved Searches: five fictional saved searches (real player/club names) removed; empty state (Save Current Search kept).')
fix(P, "T(503,514,'Thumbnall / Title',19,", "T(503,514,'Thumbnail / Title',19,", 'Typo "Thumbnall / Title" → "Thumbnail / Title".')
fixline(P, "var R=[['De Bruyne Progressive Passes'", "var R=[];[587,678,767,857,946,1036,1125,1211,1298].forEach(function(y){D(427,y+45,1554,1,'','background:#10294a')});T(1204,587,'No assets yet — new projects, reels, reports and exports will appear here',20,'c','color:#8ea3bf');",
        'Asset table: ten fictional assets (titles, players, collaborators, dates, statuses) removed; ten-row ruling kept; empty state in row 1. Removes the "Awaiting actual status" pills that overflowed by ~96 px.')
for pre in ["['Match Analysis - Full Report'", "['Vin\\u00EDcius J\\u00FAnior 1v1 Skills'", "['Real Madrid Defensive Shape'", "['Man City Set Pieces'", "['Bellingham Key Actions'", "['UCL Quarter-Final Scouting Pack'", "['Man City Training Session'", "['Post-Match Press Conference'", "['Quarter-Final Highlights'"]:
    fixline(P, pre, "", 'Asset table: fictional row data removed.')
fix(P, "T(2469,439,'05:26',22,'sb c');", "T(2469,439,'—',22,'sb c');", 'Selected Item: fictional duration removed.')
fix(P, "T(2025,503,'De Bruyne Progressive Passes',26,'b');", "T(2025,503,'No asset selected',26,'b');", 'Selected Item: fictional title removed.')
fix(P, "[['Reel',2027,65,1],['De Bruyne',2104,104,0],['Progressive',2220,111,0],['UCL',2343,53,0],['+2',2408,47,0]].forEach(", "[].forEach(", 'Selected Item: fictional type/tag chips removed (previous "Player not selected" overflowed its chip by 139 px).')
fix(P, "T(2027,599,'All progressive passes and key build-up actions from',22,'','color:#d6e4f7');T(2027,629,'Kevin De Bruyne vs Real Madrid.',22,'','color:#d6e4f7');", "T(2027,599,'Select an asset in the table to see its details.',22,'','color:#d6e4f7');", 'Selected Item: fictional description removed.')
fix(P, "I(2237,688,'ball',36,'#cfe0f5');T(2278,688,'UEFA Champions League',20,'','color:#e3eefb');", "T(2244,688,'—',20,'','color:#e3eefb');", 'Selected Item Competition: fictional value and logo removed.')
fix(P, "CREST(2234,737,34);CREST(2282,737,34);T(2332,737,'2 - 1',20,'sb','color:#fff');CREST(2377,737,34);T(2415,737,'Real Madrid',20,'','color:#e3eefb');", "T(2244,737,'—',20,'','color:#e3eefb');", 'Selected Item Match: fictional crests/score/club removed (value previously ran past the 2560 px stage edge).')
fix(P, "PH(2237,786,36);PH(2276,786,36);PH(2314,786,36);T(2341,787,'De Bruyne, Foden, Rodri',14,'','color:#b9cbe2');T(2503,788,'+1',14,'lb');", "T(2244,786,'—',20,'','color:#e3eefb');", 'Selected Item Players Featured: real players removed.')
fix(P, "AV(2240,832,40,'JD','#2b5ff0');T(2276,832,'John Doe',20,'','color:#e3eefb');", "T(2244,832,'—',20,'','color:#e3eefb');", 'Selected Item Created By: fictional user removed.')
fix(P, "T(2222,873,'16 Apr 2024, 14:32',20,'','color:#e3eefb');T(2222,913,'5:26',20,'','color:#e3eefb');T(2222,952,'742 MB',20,'','color:#e3eefb');T(2222,988,'1080p (Full HD)',20,'','color:#e3eefb');",
       "T(2244,873,'—',20,'','color:#e3eefb');T(2244,913,'—',20,'','color:#e3eefb');T(2244,952,'—',20,'','color:#e3eefb');T(2244,988,'—',20,'','color:#e3eefb');", 'Selected Item: fictional curated date, duration, file size and resolution removed.')
fix(P, "[['De Bruyne',2221,85],['Progressive',2315,89],['Reels',2412,58],['+2',2476,42]].forEach(", "T(2244,1031,'—',20,'','color:#e3eefb');[].forEach(", 'Selected Item Tags: fictional tags removed.')
fix(P, "D(2158,1297,36,30,'ch');T(2176,1312,'55',17,'c');", "D(2178,1297,36,30,'ch');T(2196,1312,'0',17,'c');", 'Collaborators: fictional count 55 → 0; count chip moved 20 px right so it no longer overlaps the heading.')
fixline(P, "[['JD','John Doe','Analyst',2049,2087,'#2b5ff0']", "T(2029,1369,'No collaborators yet',18,'','color:#8ea3bf');", 'Collaborators: fictional people (John Doe, Sarah Kim, Mike Chen) removed.')
fixline(P, "D(2463,1343,52,52,", "", 'Collaborators: fictional "+2" removed.')

# =============================== 10 EXPORT ===============================
P = '10'
fix(P, "T(52,202,'Render, brand and deliver professional',22,'','color:#cfe0f5');T(52,230,'video insights to your team and clients.',22,'','color:#cfe0f5');",
       "T(52,202,'Render, brand and deliver professional',21,'','color:#cfe0f5');T(52,230,'video insights to your team and clients.',21,'','color:#cfe0f5');", 'Intro copy 22→21 px so line 2 no longer overflows the panel (+6 px).')
fix(P, "D(39,449,379,75,'','background:linear-gradient(90deg,#0b2b57,#08213f);border:1.5px solid #1e5fa8;border-radius:8px');", "D(39,282,379,75,'','background:linear-gradient(90deg,#0b2b57,#08213f);border:1.5px solid #1e5fa8;border-radius:8px');",
    'Wizard: current-step band moved from "Render & Process" to step 1 (nothing has been finalised).')
fix(P, "[[1,318,'Edit & Finalize','Review highlights and settings',1],[2,400,'Export Settings','Choose format, branding and output',1],", "[[1,318,'Edit & Finalize','Review highlights and settings',0],[2,400,'Export Settings','Choose format, branding and output',0],",
    'Wizard: false completion ticks on steps 1–2 removed (also removes the tick that overlapped "Choose format, branding and output").')
fix(P, "s[0]==3?'background:#0a84ff;border-radius:50%'", "s[0]==1?'background:#0a84ff;border-radius:50%'", 'Wizard: active step circle moved to step 1.')
fix(P, "T(204,735,'Kevin De Bruyne',24,'sb');T(204,764,'Progressive Passes',22,'','color:#e3eefb');", "T(204,735,'No project open',24,'sb');T(204,764,'Open a reel to export',22,'','color:#e3eefb');", 'Project Summary: fictional player/reel removed.')
fix(P, "[['ball','Source Match','Man City vs Real Madrid',865],['ball','Competition','UEFA Champions League',900],['cal','Date','Tue, 16 Apr 2024',936],['clock','Duration','02:17 (12 clips)',974]]",
       "[['ball','Source Match','—',865],['ball','Competition','—',900],['cal','Date','—',936],['clock','Duration','—',974]]", 'Project Summary: fictional match, competition (previously overflowing +18 px), date and duration removed.')
fix(P, "[['Progressive',147,98],['Passing',256,75],['UCL',341,54]].forEach(", "T(147,1017,'—',16,'','color:#cfe0f5');[].forEach(", 'Project Summary: fictional tags removed.')
fix(P, "D(585,182,60,60,'','border:3px solid #fff;border-radius:50%');T(614,272,'CHAMPIONS',20,'b c','letter-spacing:1px');T(614,292,'LEAGUE.',20,'b c','letter-spacing:1px');", "", 'Preview: third-party competition mark removed.')
fix(P, "T(1718,191,'4K',30,'b c','color:#f5b82e');", "T(1718,191,'—',30,'b c','color:#f5b82e');", 'Preview: fictional "4K" render badge value removed.')
fix(P, "T(534,441,'KEVIN DE BRUYNE',62,'b','letter-spacing:-1px');T(534,496,'PROGRESSIVE PASSES',44,'b','color:#1e9bff');T(536,540,'MAN CITY vs REAL MADRID',24,'sb','letter-spacing:3px');T(536,570,'16 APR 2024',24,'sb','letter-spacing:3px');",
       "T(534,441,'No reel loaded',62,'b','letter-spacing:-1px');T(534,496,'NOT RENDERED',44,'b','color:#1e9bff');T(536,540,'OPEN A REEL FROM THE LIBRARY',24,'sb','letter-spacing:3px');T(536,570,'—',24,'sb','letter-spacing:3px');",
       'Preview title card: fictional player/reel/match/date removed (the long name previously ran under the play button).')
fix(P, "[['run','12','Key Passes',397],['srch','8','Progressive Passes',472],['trophy','6','Chance Creation',547]].forEach(function(c){D(1498,c[3],258,62,", "[['run','—','Key Passes',397],['srch','—','Progressive Passes',472],['trophy','—','Chance Creation',547]].forEach(function(c){D(1498,c[3],278,62,",
    'Preview stat cards: surviving fictional values 12/8/6 removed; cards widened 258→278 px so "Progressive Passes" fits (was +10 px).')
fix(P, "T(622,686,'00:00 / 02:17',20);", "T(622,686,'00:00 / 00:00',20);", 'Preview transport: fictional duration removed.')
fix(P, "D(750,683,355,5,'','background:#cfe0f5;border-radius:3px');", "", 'Preview transport: fictional progress removed.')
fix(P, "T(736,761,'Auto Chapters',16,", "T(726,761,'Auto Chapters',16,", '"Auto Chapters" label moved 10 px left so it no longer touches its toggle.')
fix(P, "T(487,758,'Highlight Chapters (12)',23,'sb');", "T(487,758,'Highlight Chapters (0)',23,'sb');", 'Chapters header count corrected (was 12 with six cards).')
fixline(P, "[['Intro','00:18',509,194]", "T(1128,860,'No chapters yet — chapters are created from the reel timeline',19,'c','color:#8ea3bf');[].forEach(function(c,i){", 'Chapters: six fictional chapter cards with durations removed; empty state.')
fix(P, "D(481,942,118,3,'','background:#1e90ff');", "", 'Chapters: selected-chapter underline removed.')
fix(P, "T(1922,781,'VIDEO INTELLIGENCE ENGINE',8,'b','color:#33a8ff');", "T(1922,785,'VIDEO INTELLIGENCE ENGINE',8,'b','color:#33a8ff');", 'Brand selector wordmark: tagline moved 4 px down so it no longer overlaps "OTSI VIE".')
fix(P, "T(2297,848,'VIDEO INTELLIGENCE ENGINE',9,'b','color:#33a8ff');", "T(2297,852,'VIDEO INTELLIGENCE ENGINE',9,'b','color:#33a8ff');", 'Brand preview wordmark: tagline moved 4 px down so it no longer overlaps "OTSI VIE".')
fix(P, "T(482,1007,'Export Queue (3)',22,'sb');", "T(482,1007,'Export Queue (0)',22,'sb');", 'Export Queue count corrected.')
fixline(P, "D(464,1035,708,93,", "T(815,1150,'No render jobs queued',20,'c','color:#8ea3bf');", 'Export Queue: fictional rendering job removed.')
fixline(P, "T(590,1056,'Kevin De Bruyne - Progressive Passes'", "", 'Export Queue: fictional job title/spec/"Rendering..." removed.')
fixline(P, "D(590,1104,202,10,", "", 'Export Queue: fictional 99 %-filled progress bar, "68%" and "12 min remaining" removed.')
fixline(P, "D(1052,1065,37,35,'in');", "", 'Export Queue: job pause/cancel controls removed with the job.')
fix(P, "[['Team Build Up Sequences','MP4 \\u2022 1080p \\u2022 16:9 \\u2022 03:42','Queued',1140,1158,1185,1183],['Defensive Transitions','MP4 \\u2022 1080p \\u2022 16:9 \\u2022 02:58','Waiting...',1215,1234,1262,1260]].forEach(", "[].forEach(", 'Export Queue: two fictional queued jobs removed (their spec lines were partly clipped).')
fix(P, "[['Include Performance Report (PDF)','Key actions, stats and insights',1058,1,'#d22'],['Include Player Analysis PDF','AI-generated tactical analysis',1124,1,'#1e6fe0'],['Include Event List (CSV)','All clips and events with timestamps',1192,0,'#1fa862'],['Include Heatmaps (PNG)','Tactical visualizations',1251,0,'#2a8af0']]",
       "[['Performance Report (PDF)','Key actions, stats and insights',1058,1,'#d22'],['Player Analysis (PDF)','AI-generated tactical analysis',1124,1,'#1e6fe0'],['Event List (CSV)','All clips and events with timestamps',1192,0,'#1fa862'],['Heatmaps (PNG)','Tactical visualizations',1251,0,'#2a8af0']]",
       'Output & Reports: "Include …" prefix dropped (the checkbox already means include) so labels no longer run under the Preview chips.')
fix(P, "T(1314,r[2]-1+(i==0?0:0),r[0],17,'sb');T(1314,r[2]+24,r[1],15,'','color:#9fb3cc');", "T(1314,r[2]-1-(i>=2?5:0),r[0],17,'sb');T(1314,r[2]+24-(i>=2?7:0),r[1],15,'','color:#9fb3cc');",
    'Output & Reports rows 3–4: title/subtitle moved up so the subtitle sits inside its 58 px row (was 4 px outside).')
fix(P, "D(1989,993,84,34,'','background:#073a2a;border:1.5px solid #1a8a5e;border-radius:8px');D(2001,1003,16,16,'','background:#17c27a;border-radius:50%');T(2030,1011,'Ready',17,'','color:#3ee6a8');",
       "D(1977,993,124,34,'','background:#1a2840;border:1.5px solid #4a5a78;border-radius:8px');D(1989,1003,16,16,'','background:#8ea3bf;border-radius:50%');T(2016,1011,'Not ready',17,'','color:#dfe8f5');",
       'Shareable Link status: green "Ready" (contradicting no export) replaced by neutral "Not ready"; pill widened 84→124 px (and shifted 12 px left inside the panel) to fit.')
fix(P, "T(1662,1069,'https://otsivie.com/share/kdb-progressive-passes',19);", "T(1662,1069,'Link available after export',19,'','color:#8ea3bf');", 'Shareable Link: fictional URL removed.')
fix(P, "AV(2165,1058,52,'JD','#2b5ff0');AV(2226,1058,52,'SK','#7a2fd0');AV(2289,1058,52,'MC','#f5a623');", "T(2140,1058,'No members yet',18,'','color:#8ea3bf');", 'Team Collaboration: fictional members removed (add button kept).')
fix(P, "T(2154,1190,'Hi,',18);T(2154,1217,'Here is the final highlight reel for review.',18);T(2154,1242,'Let me know your feedback.',18);", "T(2154,1190,'Add a message for recipients (optional)',18,'','color:#8ea3bf');", 'Message box: placeholder instead of pre-written message.')
fix(P, "[[288,1340,'1','Preparing Files',326,'',0],[597,1340,'2','Rendering Video',635,'68%',1],[891,1342,'3','Processing Reports',931,'Waiting...',0],[1186,1342,'4','Finalizing',1229,'Waiting...',0]]",
       "[[288,1342,'1','Preparing Files',326,'Waiting...',0],[597,1342,'2','Rendering Video',635,'Waiting...',0],[891,1342,'3','Processing Reports',931,'Waiting...',0],[1186,1342,'4','Finalizing',1229,'Waiting...',0]]",
       'Render Progress: fictional "Rendering Video 68%" and active steps replaced by "Waiting..." for all four stages.')
fix(P, "s[6]||i==0?'background:#0a84ff;border:2px solid #6cc4ff;border-radius:50%'", "s[6]?'background:#0a84ff;border:2px solid #6cc4ff;border-radius:50%'", 'Render Progress: step 1 no longer shown as active.')
fix(P, "I(x,1340,'arrow',24,i?'#3a5a88':'#1e90ff')", "I(x,1340,'arrow',24,'#3a5a88')", 'Render Progress: first connector neutral.')
fix(P, "D(270,1387,726,13,'','background:#1e90ff;border-radius:7px');", "", 'Render Progress: fictional 62 % bar fill removed.')
fix(P, "D(1500,1330,38,38,'','background:#17c27a;border-radius:50%');I(1519,1349,'chk',22,'#fff');\nT(1561,1345,'Ready for Delivery',22,'sb');T(1561,1380,'Final video and reports will be available soon.',18,'lb');",
       "D(1500,1330,38,38,'','background:#26364d;border-radius:50%');\nT(1561,1345,'Delivery not ready',22,'sb');T(1561,1380,'Nothing has been rendered yet.',18,'lb');",
       'Delivery status: contradictory green success tick with "Ready for Delivery" replaced by a neutral indicator and "Delivery not ready".')

# =============================== apply ===============================
U = lambda t: re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), t)
def apply(page_file, edits):
    s = open(os.path.join(ORIG, page_file), encoding='utf-8').read()
    s = re.sub(r'<script>const PAGE_REPLACEMENTS=.*?</script>\n', '', s, flags=re.S)
    s = U(s)
    s = s.replace('if(t)e.textContent=cleanReferenceText(t)', 'if(t!==undefined&&t!==null&&t!=="")e.textContent=t').replace('e.textContent=cleanReferenceText(t)', 'e.textContent=t')
    notes = [GLOBAL_NOTE] if 'cleanReferenceText' in open(os.path.join(ORIG, page_file), encoding='utf-8').read() else []
    for old, new, note, count in edits:
        old, new = U(old), U(new)
        n = s.count(old)
        if n != count: raise SystemExit(f'{page_file}: expected {count} match(es), found {n}: {old[:120]!r}')
        s = s.replace(old, new); notes.append(note)
    assert 'cleanReferenceText(' not in s.split('function cleanReferenceText')[0] if 'function cleanReferenceText' in s else True
    open(os.path.join(OUT, page_file), 'w', encoding='utf-8', newline='\n').write(s)
    return notes
os.makedirs(OUT, exist_ok=True)
register = {}
for f in sorted(os.listdir(ORIG)):
    if f.endswith('.html') and f[:2].isdigit():
        register[f] = apply(f, E.get(f[:2], []))
json.dump(register, open(os.path.join(OUT, '_register.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print({k: len(v) for k, v in register.items()})
