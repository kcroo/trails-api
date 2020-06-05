### start new gcloud project and set it as default
gcloud projects create final-493-corraok  --set-as-default

### setup new app
gcloud app create --project=final-493-corraok

### when prompted, choose region 
16 for US-west2

### enable billing for project
https://console.cloud.google.com/projectselector2/billing

### install JS libraries in package.json
npm install 

### authenticate with new key for project
https://cloud.google.com/docs/authentication/getting-started?authuser=1

### run server locally
export GOOGLE_APPLICATION_CREDENTIALS="final-493-corraok-key.json"
npm start --trace-warnings

### run locally with forever; restarts if changes to files
export GOOGLE_APPLICATION_CREDENTIALS="final-493-corraok-key.json"
forever -w server.js

### deploy to gcloud 
gcloud app deploy 

### see list of gcloud projects 
gcloud projects list

### view/edit/delete datastore contents online
https://console.cloud.google.com/datastore/entities;kind=Boat;ns=__$DEFAULT$__/query/kind?authuser=1&project=hw5-493-corraok&folder=&organizationId=

### enable google people API

### oauth consent screen 
application type: public 
application name: final-493-corraok
scopes: default (email, profile, openid)
NO PHOTO
URL: project URL

### create oauth client ID 
application type: web application
name: final-493-corraok
authorized javascript origins: http://localhost:8001
authorized redirect URIs: http://localhost:8001/users
