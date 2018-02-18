#! /usr/bin/env node
"use strict";

//
//  index.js
//  arangodb-foxx-upload
//
//  Created by Gerrel Krishan on 2018-02-17.
//	Copyright (C) 2018 Gerrel Krishan
//
//  MIT LICENSE
//

var http = require('http');
var https = require("https");
var fs = require('fs');
var os = require('os');
var compressing = require('compressing');
var pipe = require('multipipe');
var request = require('request');

var CONFIG_PATH = './.arangodb';
var SSH_PATH = `${os.homedir()}/.ssh/`;
var PACKAGE_PATH = './package.json';

console.log('Preparing...');
var deleteFolderRecursive = function(path) {
  if (fs.existsSync(path)) {
    fs.readdirSync(path).forEach(function(file, index){
      var curPath = path + "/" + file;
      if (fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
};

deleteFolderRecursive("./dist");

console.log('Initializing configuration...');

if (!fs.existsSync(CONFIG_PATH)) {
  console.error('Config file not found. (add .arangodb in your project root)');
  return;
}

var config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH));
} catch (err) {
  console.error('Config file does not have proper json format');
  return;
}

var project;
try {
  project = JSON.parse(fs.readFileSync(PACKAGE_PATH));
} catch (err) {
  console.error('package.json file does not have proper json format');
  return;
}

if (config.host === undefined || typeof config.host !== 'string') {
  console.error('Config [host] string property is required');
  return;
}
if (config.username === undefined || typeof config.username !== 'string' || config.password === undefined || typeof config.password !== 'string') {
  console.error('Config [username] and/or [password] string properties are required');
  return;
}
if (config.ssl === undefined || typeof config.ssl !== 'boolean' || config.port === undefined || typeof config.port !== 'number') {
  console.error('Config [ssl] boolean property and [port] number property are required');
  return;
}
if (config.service === undefined || typeof config.service !== 'string') {
  console.error('Config [service] string property property is required');
  return;
}

var defaultOptions = {
  port: config.port,
  host: config.host
};

if (config.client_passphrase !== undefined && typeof config.client_passphrase === 'string') {

  var certPath = `${SSH_PATH}${config.host}.crt`;
  var keyPath = `${SSH_PATH}${config.host}.key`;
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    console.log('Attaching client certificate...');
    defaultOptions.cert = fs.readFileSync(certPath);
    defaultOptions.key = fs.readFileSync(keyPath);
    defaultOptions.rejectUnauthorized = false;
    defaultOptions.passphrase = config.client_passphrase;
  } else {
    console.error(`Config [client_passphrase] is a optional string property the files ${certPath} and ${keyPath} are not found`);
    return;
  }

}

if (project.arangodb === undefined) {
  console.error('package.json does not contain arangodb property');
  return;
}

if (project.arangodb.mount === undefined || typeof project.arangodb.mount !== 'string' || project.arangodb.mount.length === 0 || project.arangodb.mount === '/') {
  console.error('package.json does not contain valid arangodb.mount property');
  return;
}

if (project.arangodb.data === undefined || !(project.arangodb.data instanceof Array)) {
  console.error('package.json does not contain valid arangodb.data property (list of files and/or directories to package)');
  return;
}

/* Functions */

function doRequest(optionsr, data, file, callback) {
  
  var client = config.ssl ? https : http;

  var options = Object.assign({}, defaultOptions, optionsr);

  var req = client.request(options, function(res) {
    
    var bodyChunks = [];
    res.on('data', function(chunk) {
      bodyChunks.push(chunk);
    }).on('end', function() {
      var body = Buffer.concat(bodyChunks);
      
      // console.log(body.toString('utf8'));
      
      var json = JSON.parse(body);
      
      // if (json.error) {
      //   console.log('STATUS: ' + res.statusCode);
      //   console.log('HEADERS: ' + JSON.stringify(res.headers));
      //   console.log('BODY: ' + body);
      // }
      callback(json);
    });
  });

  req.on('error', function(e) {
    // console.log('ERROR: ' + e.message);
  });

  if (data) {
    req.write(data);
  }
  if (file) {
    fs.readFile(file, function(err, data) {
      req.write(data);
    });
  }

  req.end();
}

function authenticate(callback) {
  return new Promise((resolve, reject) => {
    console.log('Authenticating...');

    var options = {
      path: '/_open/auth',
      method: 'POST',
      headers: {
          'Content-Type': 'application/json'
      }
    };
    
    doRequest(options, `{"username":"${config.username}","password":"${config.password}"}`, null, (json) => {
      if (json.error) {
        reject(json);
        return callback ? callback(null) : null;
      }

      var jwt = json.jwt;
      resolve(jwt);
      return callback ? callback(jwt) : null;
    });
  });
}

function createDatabase(jwt, callback) {
  return new Promise((resolve, reject) => {
    console.log('Setting up database...');
    
    var options = {
      path: '/_api/database',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `bearer ${jwt}`
      }
    };

    doRequest(options, `{"name":"${config.service}"}`, null, (json) => {
      
      if (json.result === true || json.code === 409){
        resolve(true);
        return callback ? callback(true) : null;
      }

      reject(json);
      return callback ? callback(false) : null;
    });
  });
}

function createManifest(callback) {
  return new Promise((resolve, reject) => {
    console.log('Processing manifest...');
    fs.mkdir('dist',function(e){
      if(!e || (e && e.code === 'EEXIST')){

      fs.readFile('manifest.json', 'utf8', function (err, data) {
        if (err) {
          reject(err);
          return callback ? callback(err) : null;
        }

        var result = data;
        if (config.manifest !== undefined) {
          var keys = Object.keys(config.manifest);
          keys.forEach(element => {
            result = data.replace(new RegExp(`<${element}>`, 'g'), config.manifest[element]);
          });
        }
      
        fs.writeFile('dist/manifest.json', result, 'utf8', function (err) {
          if (err) {
            reject(err);
            return callback ? callback(err) : null;
          }
          resolve(true);
          return callback ? callback(true) : null;
        });
      });
    }});
  });
}

function createPackage(callback) {
  return new Promise((resolve, reject) => {
    console.log('Creating package...');
    fs.mkdir('dist',function(e){
        if(!e || (e && e.code === 'EEXIST')){
          
          var system = ['dist/manifest.json'];
          system = system.concat(project.arangodb.data);

          newArchive(`dist/package.zip`, system, (success) => {
            resolve(success);
            return callback ? callback(success) : null; 
          });

        } else {
            reject(e);
            return callback ? callback(false) : null;
        }
    });
  });
}

function newArchive(zipFileName, pathNames, callback) {
  
  var tarStream = new compressing.zip.Stream();
   pathNames.forEach(path => {
    tarStream.addEntry(path);
  });

  var destStream = fs.createWriteStream(zipFileName);
  pipe(tarStream, destStream, (error) => {
    callback(error == null);
  });

}

function uploadPackage(jwt, callback, update) {

  return new Promise((resolve, reject) => {
    console.log(`${update ? '[UPDATE]' : '[CREATE]'} Uploading package...`);

    var scheme = config.ssl ? 'https' : 'http';
    var mount = encodeURI(project.arangodb.mount);
    var optionsr = {
      url: update ? `${scheme}://${defaultOptions.host}:${defaultOptions.port}/_db/${config.service}/_api/foxx/service?mount=${mount}` 
                  : `${scheme}://${defaultOptions.host}:${defaultOptions.port}/_db/${config.service}/_api/foxx?mount=${mount}`,
      method: update ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/zip',
        'Authorization': `bearer ${jwt}`
      }
    };
    var options = Object.assign({}, defaultOptions, optionsr);
    
    fs.createReadStream('dist/package.zip').pipe(request(options)).on('response', function(response) {
      console.log(response.statusCode) // 200
      
      if (response.statusCode == 400) {
        uploadPackage(jwt, callback, false);
      } else if(response.statusCode == 200) {
        resolve(true);
        return callback ? callback(true) : null;
      }
      reject(response);
      return callback ? callback(response) : null;

    }).on('error', function(err) {
      // console.log(err);
    }).on('data', function(data) {
      // decompressed data as it is received
      // console.log('body: ' + data);
    });
  });
}

/* -- --- -- */


authenticate()
.then(jwt => {
  return createDatabase(jwt).then(result => {
  }).then(result => {
    return createManifest();
  }).then(result => {
    return createPackage();
  }).then(result => {
    return uploadPackage(jwt, null, true).catch(result => {
      return uploadPackage(jwt, null, false);
    });
  }).then(result => {
    console.log('Finished');
  });
})
.catch(console.error);
