/*
Author: Kirsten Corrao
Date: 5/30/2020
Final Project
Sources:
GAE Documentation for node.js
Nunjucks templates: https://mozilla.github.io/nunjucks/getting-started.html
HTML input types: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input
people API discovery docs: https://developers.google.com/people/api/rest
main source - google API library - oauth: https://github.com/googleapis/google-api-nodejs-client/#authentication-and-authorization
authentication with id_token: https://developers.google.com/identity/sign-in/web/backend-auth
slice to remove part of string: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/slice
see if key exists in object: https://stackoverflow.com/questions/1098040/checking-if-a-key-exists-in-a-javascript-object
pagination: https://stackoverflow.com/questions/44184469/google-cloud-datastore-how-to-query-for-more-results
pagination: https://cloud.google.com/datastore/docs/concepts/queries?authuser=1#cursors_limits_and_offsets
key-only queries to get total number of entities of a certain type: https://cloud.google.com/datastore/docs/concepts/queries
*/

// set up necessary libraries
const express = require('express');
const bodyParser = require('body-parser');
const fs = require("fs");
const nunjucks = require('nunjucks');
const request = require("request-promise");
const jwtDecode = require('jwt-decode');
const {Datastore} = require('@google-cloud/datastore');
const {google} = require('googleapis');

const app = express();
app.use('/public', express.static('public'))
app.use(bodyParser.json());

nunjucks.configure('views', { 
  autoescape: true,
  express: app
 });

const datastore = new Datastore();

// url to add all other routes to
const URL = "http://localhost:8001/";
//const URL = "https://hw7b-493-corraok.wl.r.appspot.com/";

// number of entities to display per page in pagination 
const RESULTS_PER_PAGE = 5;


/*** error codes ***/ 
// error when request's body is missing an attribute
const attributeMissingError = {
  "code": 400,
  "data": {
    "error": "The requested object is missing at least one of the required attributes"
  }
};

const datastoreQueryError = {
  "code": 400,
  "data": {
    "error": "Could not retrieve items from datastore."
  }
};

// error if ID token is not valid and user can't be authenticated
const userNotAuthenticatedError = {
  "code": 401,
  "data": {
    "error": "The user cannot be authenticated."
  }
}

// error when authenticated user tries to modify an item that they don't own
const forbiddenError = {
  "code": 403,
  "data": {
    "error": "That action is forbidden for the authenticated user."
  }
};

// error when client requests an ID that doesn't exist in datastore
const itemNotFoundError = {
  "code": 404,
  "data": {
    "error": "No object with this ID exists"
  }
};

/*** datastore entities***/
// name is datastore entity name; URL can be use to build entity's URL; attributes are those required when user POSTs new entity
const USER = {
  "name": "User",
  "URL": "users/",
  "requiredAttributes": ["username", "email"]
};

const TRAIL = {
  "name": "Trail",
  "URL": "trails/",
  "requiredAttributes": ["name", "length", "difficulty"],
  "protected": true
};

const TRAILHEAD = {
  "name": "Trailhead",
  "URL": "trailheads/",
  "requiredAttributes": ["name", "location", "fee"],
  "protected": false
};


/*** OAuth ***/
// file with client ID and secret
const oauthFile = JSON.parse(fs.readFileSync("oauth/client_secret.json", 'utf8'));
const CLIENT_ID = oauthFile.web.client_id;
const CLIENT_SECRET = oauthFile.web.client_secret;
const REDIRECT_URL = oauthFile.web.redirect_uris[0];

// create oauth client with credentials in file
const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URL
);

// user will grant access to profile info
const oauthURL = oauth2Client.generateAuthUrl({
  access_type: 'online',
  scope: 'https://www.googleapis.com/auth/userinfo.profile'
});

// verifies if the user is authenticated through google 
// input: IdToken of user
// output: returns object of user info if authenticated; otherwise returns false
async function verifyUser(idToken) {
  if (idToken === undefined || idToken === '') {
    return false;
  }

  // remove 'Bearer' from beginning of token that Postman adds
  if (idToken.slice(0, 7) === 'Bearer ') {
    idToken = idToken.slice(7);
  }

  const ticket = await oauth2Client.verifyIdToken({
    idToken: idToken,
    audience: CLIENT_ID
  }).catch(error => {
    console.log("error authenticating user", error);
    return false;
  });

  return ticket;      // returns false if user not authenticated; otherwise contains user info
}



/*** helper functions ***/

// builds and returns self URL for an entity (ex: http://mysite.com/boats/12345)
// input: ID of entity; type of entity (e.g. BOAT)
// output: self URL for entity
function makeSelfURL(id, type) {
  return URL + type.URL + id;
}

// returns an entity from datastore
// input: entity's ID and type (e.g. BOAT)
// output: entity, which contains its key and all properties
async function getEntityFromDatastore(id, type) {
  const key = datastore.key([type.name, parseInt(id)]);
  const [entity] = await datastore.get(key).catch(error => console.log(error));
  return entity;
}

// returns a trails's information in JSON
// input: trailEntity from datastore 
// output: object containing ID, properties, and self URL
function makeTrailFormatJSON(trailEntity) {
  return {
    "name": trailEntity.name,
    "length": trailEntity.length,
    "difficulty": trailEntity.difficulty,
    "id": trailEntity[Datastore.KEY].id,
    "self": makeSelfURL(trailEntity[Datastore.KEY].id, TRAIL)
  }
}

// returns a trailheads's information in JSON
// input: trailheadEntity from datastore 
// output: object containing ID, properties, and self URL
function makeTrailheadFormatJSON(trailheadEntity) {
  return {
    "name": trailheadEntity.name,
    "location": trailheadEntity.location,
    "fee": trailheadEntity.fee,
    "id": trailEntity[Datastore.KEY].id,
    "self": makeSelfURL(trailEntity[Datastore.KEY].id, TRAIL)
  }
}


// returns a formatted array of entitites according to its type 
// input: type (e.g. TRAIL, TRAILHEAD); array of entities from datastore 
// output: array of information formatted in JSON, which includes IDs, properties, and self URLs for each entity
async function makeResponseByType(type, entities) {
  let response = {};

  if (type.name === 'Trail') {
    response = Promise.all(
      entities.map( async (trail) => {
        return makeTrailFormatJSON(trail);
      })
    );
  } else if (type.name === 'Trailhead') {
    response = Promise.all(
      entities.map( async (trailhead) => {
        return makeTrailheadFormatJSON(trailhead);
      })
    );
  }

  return response;
}

// builds and returns next page URL for pagination results (ex: http://mysite.com/trails/12345)
// encodes the cursor string to replace '+' characters with "%2B"
// input: type of entity (e.g. TRAIL, TRAILHEAD); cursor that points to next page in results 
// output: URL for next page of results
function makeNextPageURL(type, cursor) {
  const encodedCursor = encodeURIComponent(cursor);
  return URL + type.URL + "?nextPage=" + encodedCursor;
}

// get page of results for a type of entity
// input: type of entity (e.g. TRAIL, TRAILHEAD); if nextPageCursor is defined, results start at that page
// output: array of formatted items; next URL contains next page of results, if it exists
async function getEntitiesPagination(type, idToken, nextPageCursor) {
  // all responses get code 200; data will hold items, self URL, and next URL if needed
  const response = {
    "code": 200,
    "data": {}
  }

  let userData = null;

  // if this entity is protected, authenticate the user
  if (type.protected) {
    userData = await verifyUser(idToken).catch(error => console.log("error authenticating user", error));

    if (userData === false) {
      return userNotAuthenticatedError;
    }
  }

  let countQuery = null;
  let pageQuery = null;

  // create query: only get the current user's entities if the resource is protected; otherwise get them all
  if (userData) {
    countQuery = datastore.createQuery(type.name).select('__key__').filter('userId', '=', userData.payload.sub);
    pageQuery = datastore.createQuery(type.name).filter('userId', '=', userData.payload.sub).limit(RESULTS_PER_PAGE);
  } else {
    countQuery = datastore.createQuery(type.name).select('__key__');
    pageQuery = datastore.createQuery(type.name).limit(RESULTS_PER_PAGE);
  }

  // get count of # of entities of this type
  let results = await datastore.runQuery(countQuery).catch(error => console.log(error));
  response.data.count = results[0].length;

  // if nextPageCursor argument is set, set query to start on that page and use it to make self URL; otherwise make standard URL without id
  if (nextPageCursor) {
    pageQuery = pageQuery.start(nextPageCursor);
    response.data.self = makeNextPageURL(type, nextPageCursor);
  } else {
    response.data.self = makeSelfURL("", type);
  }

  // get results, where index 0 is items and index 1 is metadata about query
  results = await datastore.runQuery(pageQuery).catch(error => console.log(error));

  if (results) {
    const items = results[0];
    const info = results[1];
  
    // format reseponse items according to type (e.g. boat or load)
    response.data.items = await makeResponseByType(type, items).catch(error => console.log(error));
  
    // if there are more pages of items in datastore, also set next URL for next page
    if (info.moreResults !== Datastore.NO_MORE_RESULTS) {
      response.data.next = makeNextPageURL(type, info.endCursor);
    }
  }
  
  return response;
}

// get all items of a particular type (e.g. USER, TRAILS, TRAILHEADS); no user authentication is needed or checked
// input: type of item
// output: code 200 and array of JSON items of that type
async function getItemsByType(type) {
  // all responses get code 200; data will hold items, self URL, and next URL if needed
  const response = {
    "code": 200,
    "data": {
      "items": []
    }
  }
  // get all items of that type, with certain number per page 
  let query = datastore.createQuery(type.name);

  // get results, where index 0 is items and index 1 is metadata about query for pagination
  const results = await datastore.runQuery(query)
    .catch(error => {
      console.log("error getting all items from datastore", error);
      return datastoreQueryError;
    });

  // if results from database, format each in JSON
  if (results) {
    const items = results[0]; 
    response.data.items = await makeResponseByType(type, items)
      .catch(error => console.log("error making response by time", error));
  }
  
  return response;
}


/*** route functions ***/

// posts new item. client must send all required attributes for item in body.
// input: name and type (strings); length (int)
// output on success: returns code 201 and formatted boat data if successful (name, type, length, ID, and self URL)
// error: 400 if name, type, or length are missing; 401 if user can't be authenticated by ID token
async function postEntity(type, idToken, body){
  // check if any required attributes are missing from post
  for (const attr of type.requiredAttributes) {
    if (!(attr in body)) {
      return attributeMissingError
    }
  }

  // will build new item here
  let newEntity = {};

  // if this entity is protected, authenticate the user and set the item's user ID
  if (type.protected) {
    const userData = await verifyUser(idToken).catch(error => console.log("error authenticating user", error));

    if (userData === false) {
      return userNotAuthenticatedError;
    }

    newEntity.userId = userData.payload.sub;
  }

  // set all required attributes for this type
  for (const attr of type.requiredAttributes) {
    newEntity[attr] = body[attr];
  }

  // make key and self URL attribute for all items
  const key = datastore.key(type.name);
  
  await datastore.save({ "key": key, "data": newEntity })
    .catch(error => {
      console.log("error saving to datastore: ", error)
    });

  // response to client also needs item's ID and self URL
  newEntity.id = key.id;
  newEntity.self = makeSelfURL(key.id, type);
  
  // success: code 201 and new boat data
  return {
    "code": 201,
    "data": newEntity 
  }
}

// put an existing entity for an authenticated user- requires all attributes to be provided and replaced
// input: ID, type, and data to update
// output on error: error if incomplete data, entity doesn't exist, or user can't be authenticated
// output on success: updates datastore and returns object of data, ID, self URL, and status code
async function putEntity(id, type, idToken, body) {
  // will save changes to this object
  let updatedEntity = {
    "code": 200,
    "data": {}
  };

  // return error if any required attribute of that type is missing
  for (const attr of type.requiredAttributes) {
    if (!(attr in body)) {
      return attributeMissingError;
    }
    updatedEntity.data[attr] = body[attr];
  }

  // will fill out this object if the resource is protected
  let userData = null;

  // if item is protected, return error if user can't be authenticated
  if (type.protected) {
    userData = await verifyUser(idToken).catch(error => console.log("error authenticating user", error));

    if (userData === false) {
      return userNotAuthenticatedError;
    }
  }

  // get item from datastore - error if item's ID can't be found
  const entity = await getEntityFromDatastore(id, type).catch(error => console.log(error));

  if (!entity) {
    return itemNotFoundError;
  }

  // return error if item is protected and doesn't belong to the authenticated user
  if (type.protected && entity.userId !== userData.payload.sub) {
    return forbiddenError;
  }

  // update entity according to body data sent by client (use updatedEntity -- body may have additional attributes that you don't want)
  for (const attr in updatedEntity.data) {
    entity[attr] = updatedEntity.data[attr];
  }

  // update entity in datastore
  await datastore.update(entity).catch(error => console.log(error));

  // add information to send back to client
  updatedEntity.data.id = id;
  updatedEntity.data.self = makeSelfURL(id, type);
  updatedEntity.data.userId = userData.payload.sub;

  return updatedEntity;
}

// patch an existing entity - only those attributes provided in body will be replaced
// input: ID, type, and data to update
// output: error if entity doesn't exist; otherwise updates datastore and returns object of data, ID, self URL, and status code
async function patchEntity(id, type, idToken, body) {
  // will save changes to this object
  let updatedEntity = {
    "code": 200,
    "data": {}
  };

  let userData = null;

  // if item is protected, return error if user can't be authenticated; otherwise set userID
  if (type.protected) {
    userData = await verifyUser(idToken).catch(error => console.log("error authenticating user", error));

    if (userData === false) {
      return userNotAuthenticatedError;
    }

    updatedEntity.data.userId = userData.payload.sub;
  }

  // get item from datastore - error if item's ID can't be found
  const entity = await getEntityFromDatastore(id, type).catch(error => console.log(error));

  if (!entity) {
    return itemNotFoundError;
  }

  // return error if item is protected and doesn't belong to the authenticated user
  if (type.protected && entity.userId !== userData.payload.sub) {
    return forbiddenError;
  }

  // update attributes that are in body
  for (const attr of type.requiredAttributes) {
    if (attr in body) {
      updatedEntity.data[attr] = body[attr];
    } else {
      updatedEntity.data[attr] = entity[attr];
    }
  }

  // save changes to datastore
  await datastore.update(entity).catch(error => console.log(error));

  // add information to send back to client
  updatedEntity.data.id = id;
  updatedEntity.data.self = makeSelfURL(id, type);

  return updatedEntity;
}

// delete an existing entity; if it's protected, it authenticates the user and checks if the user owns the entity
// input: trailId to delete
// output on success: code 204 after entity is deleted
// output on error: code 403 if user doesn't own the entity; 404 if entity doesn't exist
async function deleteEntity(id, type, idToken) {
  // get entity with that ID from datastore
  const entity = await getEntityFromDatastore(id, type).catch(error => console.log(error));

  // 404 if entity can't be found
  if (!entity) {
    return itemNotFoundError;
  }

  // if the entity is protected, authenticate user and verify they own it; otherwise return error
  if (type.protected) {
    const userData = await verifyUser(idToken).catch(error => console.log("error authenticating user", error));

    if (userData === false) {
      return userNotAuthenticatedError;
    } else if (entity.userId !== userData.payload.sub) {
      return forbiddenError;
    }
  }

  // delete entity
  const key = entity[Datastore.KEY];
  await datastore.delete(key).catch(error => console.log(error));

  return {
    "code": 204,
    "data": {}
  }
}

// returns user data from the Google People API 
// input: tokens object from google that contains the access token 
// output: if successful, returns JSON containing user's name and other info; otherwise prints error to console and returns empty object
async function getUserData(token) {
  // send get request to get user's information in People API
  const getRequest = {
    url: "https://people.googleapis.com/v1/people/me/?personFields=names&access_token=" + token.access_token,
    method: "GET"
  }

  const result = await request(getRequest)
    .catch( error => {
      console.log("error getting user data from people API", error);
      return {};
    });

  // return JSON of user data
  return JSON.parse(result);
}


// *** routes *** 

// welcome page: sends authentication request to google
app.get('/', async(req, res) => {
  let data = {
    "oauthURL": oauthURL
  };

  res.render("index.html", data);
});

// display user info
app.get('/user', async(req, res) => {
  // error if no query parameters sent by google --> access denied
  if (req.query.error) {
    res.render('user.html', {"error": "Access Denied"});
  } 

  // get token for this user to authenticate them
  const code = req.query.code;
  const {tokens} = await oauth2Client.getToken(code).catch(error => console.log(error));

  oauth2Client.setCredentials(tokens);

  // get user data from people API
  const userData = await getUserData(tokens).catch(error => console.log(error));

  // prepare response variables
  const responseData = {};
  let sub = "";

  // decode JWT to get sub -> if error, display it
  try {
    sub = jwtDecode(tokens.id_token).sub;
  } catch(error) {
    console.log(error);
    responseData.error = error;
    res.render("user.html", responseData);
  }

  // format data and send
  responseData.firstName = userData.names[0].givenName;
  responseData.lastName = userData.names[0].familyName;
  responseData.jwt = tokens.id_token;
  responseData.userID = sub;

  res.render("user.html", responseData);
});

// returns array of all trails that are owned by the authenticated user, with pagination
app.get('/trails', async function(req, res){
  const result = await getEntitiesPagination(TRAIL, req.headers.authorization, req.query.nextPage);
  res.status(result.code).send(result.data);
});

// creates new trail if all data is provided in body; request and response must be JSON; otherwise error message
app.post('/trails', async(req, res) => {
  const result = await postEntity(TRAIL, req.headers.authorization, req.body).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// creates new trailhead if all data is provided in body; request and response must be JSON; otherwise error message
app.post('/trailheads', async(req, res) => {
  const result = await postEntity(TRAILHEAD, req.headers.authorization, req.body).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// replaces existing trails's information with that provided in body
app.put("/trails/:trailId", async(req, res) => {
  const result = await putEntity(req.params.trailId, TRAIL, req.headers.authorization, req.body).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// edits some or all of a trails's information
app.patch("/trails/:trailId", async(req, res) => {
  const result = await patchEntity(req.params.trailId, TRAIL, req.headers.authorization, req.body).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// deletes a trail from datastore if the authenticated user owns it
app.delete("/trails/:trailId", async(req, res) => {
  const result = await deleteEntity(req.params.trailId, TRAIL, req.headers.authorization).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// returns information about an owner's boats
app.get('/owners/:ownerID/boats', async(req, res) => {
  const result = await getOwnersBoats(req.headers.authorization).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// listen to GAE port if it exists; 8001 otherwise
const PORT = process.env.PORT || 8001;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});
