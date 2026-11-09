import os,re,sys
SRC=os.path.join(os.path.dirname(__file__),'..','sql_src'); OUT=os.path.join(os.path.dirname(__file__),'..','sql')
T={'ID36':'CHAR(36) CHARACTER SET ascii COLLATE ascii_bin','TS6':'DATETIME(6)','NOWTS':'DEFAULT CURRENT_TIMESTAMP(6)',
   'UPDTS':'DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)',
   'TBL':'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC',
   'EVSTATE':"ENUM('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED')",
   'JOBSTATE':"ENUM('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED')"}
for f in sorted(os.listdir(SRC)):
  s=open(os.path.join(SRC,f),encoding='utf-8').read()
  for k,v in T.items(): s=re.sub(r'(?<![A-Za-z0-9_])'+k+r'(?![A-Za-z0-9_])',v,s)
  open(os.path.join(OUT,f),'w',encoding='utf-8',newline='\n').write(s)
print('built',len(os.listdir(OUT)))
