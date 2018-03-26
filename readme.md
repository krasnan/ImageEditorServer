# Image Editor for MediaWiki server app

## Steps to run server application:

* install dependencies 
```
npm install
```
* configure environment variables in `/server/package.json`, 
where `api_endpoint` is your MediaWiki `api.php` url 
and `api_token` is private token 
```json
  "config": {
    "api_endpoint": "http://wiki.localhost/api.php",
    "api_token": "SET API TOKEN"
  },
```
* run node server application with command 
```
npm start
```

## Build dorcker image and run in container
* build docker image in root of application
```
docker build -t "image-editor-server/node-app" .
```
* run container with `-p` attribute to map port where server will be listening:
```
docker run -p 8180:8080 -d "image-editor-server/node-app"
```
* check if runing `nc -v wiki.matfyz.sk`