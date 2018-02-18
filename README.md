
## ArangoDB Foxx Service Deployment

This npm package makes packaging and distributing of your Foxx services possible with just one npm run command.

### Installation

```
$ npm install arangodb-foxx-upload --save-dev
```

### Configuration

1. Add a script to the package.json with the value `arangodb-deploy`

```json
"scripts": {
    "deploy": "arangodb-deploy",
    ...
}
```

2. Add `arangodb` configuration to the root of package.json
* mount - is the base url of the service
* data - contains the files and/or directories that need to be included in the package

```json
{
    ...,
    "arangodb": {
        "mount": "/api",
        "data": [
            "index.js",
            "scripts",
            "test",
            "node_modules"
        ]
    },
    ...
}
```

3. Add a `.arangodb` file to the root of the project with host configuration and secrets (which you don't commit)

```json
{
    "host": "<ip or domain>",
    "username": "<arangodb portal username>",
    "password": "<arangodb portal password>",
    "ssl": "<true|false: Boolean - does the connection use ssl?>",
    "port": "<8529: Number - on which port does arangodb run?>",
    "service": "<With which name do you want to deploy the service?>",
    "client_passphrase": "<optional: client-certificate private key passphrase",
    "manifest": {
        "jwtSecret": "<value>"
    }
}
```
The manifest-configuration will replace the values in the manifest.json of the project before packaging.
The key-value needs to be placed within `<` property `>`.

```json
...
"jwtSecret": {
      "description": "The secret encryption key of tokens",
      "default": "<jwtSecret>",
      "type": "string"
    },
...
```

## License

arangodb-foxx-upload is available under the MIT license. See the LICENSE file for more info.
