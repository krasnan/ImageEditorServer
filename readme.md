# Image Editor for MediaWiki server app

## Steps to run server application:

* install dependencies 
```
npm install
```
* configure environment variables in `/server/package.json`, where `endpoint` is your MediaWiki `api.php` address
* if you want to set endpoint dynamicly from client side, set property `dynamic_endpoint` to `"true"`
```json
  "config": {
    "endpoint": "http://wiki.localhost/api.php",
    "dynamic_endpoint": "false"
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