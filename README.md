# Baltijas batimetriskā karte

Interaktīva Baltijas jūras batimetriskā karte (prototips):

- batimetrijas attēlojums ar OpenLayers 
- bīdot peles kursoru, labjā augšējā stūrī refzdams dziļums m un koordinātas
- TID-bāzēta datu kvlitātes attēlojums
- iespēja uzzīmēt jūras dziļuma profilu

## Local run

```bash
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
