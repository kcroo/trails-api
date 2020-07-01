/*
Author: Kirsten Corrao
Date: 06/30/2020
Trails API 
*/

// set up libraries
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
const URL = "https://trails-api.wl.r.appspot.com/";

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

// error when authenticated user tries to add trailhead to trail that already exists
const alreadyExistsError = {
  "code": 403,
  "data": {
    "error": "That content already exists and cannot be added again."
  }
};

// error when authenticated user tries to add trailhead to trail that already exists
const relationshipDoesNotExistError = {
  "code": 403,
  "data": {
    "error": "That relationship does not exist."
  }
};

// error when non-protected resource is not found
const doesNotExistError = {
  "code": 404,
  "data": {
    "error": "The requested item does not exist."
  }
};

// error when trying to access a route that is not supported by API 
const methodNotAllowedError = {
  "code": 405,
  "data": {
    "error": "That method is not allowed."
  }
}

// error when request's Accept header isn't set to */* or JSON (or HTML for getBoat)
const acceptTypeError = {
  "code": 406,
  "data": {
    "error": "The request's accept type is not valid."
  }
};

/*** datastore entities***/
// name is datastore entity name; URL can be use to build entity's URL; attributes are those required when user POSTs new entity
const USER = {
  "name": "User",
  "URL": "users/",
  "requiredAttributes": ["firstName", "lastName", "userId"],
  "otherAttributes": [],
  "protected": false
};

const TRAIL = {
  "name": "Trail",
  "URL": "trails/",
  "requiredAttributes": ["name", "length", "difficulty"],
  "otherAttributes": ["trailheads"],
  "protected": true
};

const TRAILHEAD = {
  "name": "Trailhead",
  "URL": "trailheads/",
  "requiredAttributes": ["name", "location", "fee"],
  "otherAttributes": ["trails"],
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

// returns true if Accept in the request's headers does NOT allow JSON 
function acceptTypeIsNotJSON(headers) {
  return headers.accept !== "*/*" && headers.accept !== "application/json";
}

// builds and returns self URL for an entity (ex: http://mysite.com/boats/12345)
// input: ID of entity; type of entity (e.g. BOAT)
// output: self URL for entity
function makeSelfURL(id, type) {
  return URL + type.URL + id;
}

// returns an entity from datastore. if userId is provided, it only returns an entity that belongs to that user
// input: entity's ID, type, and userId if it is a protected resource
// output: entity, which contains its key and all properties
async function getEntityFromDatastore(id, type, userId) {
  let entity = null;

  if (userId) {
    const query = datastore.createQuery(type.name)
      .filter('userId', '=', userId)
      .filter('__key__', '=', datastore.key([type.name, parseInt(id)]));

    const results = await datastore.runQuery(query).catch(error => console.log(error));

    if (results[0].length > 0) {
      entity = results[0][0]
    }
  } else {
    const key = datastore.key([type.name, parseInt(id)]);
    [entity] = await datastore.get(key).catch(error => console.log(error));
  }
  
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
    "trailheads": trailEntity.trailheads,
    "id": trailEntity[Datastore.KEY].id,
    "userId": trailEntity.userId,
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
    "trails": trailheadEntity.trails,
    "id": trailheadEntity[Datastore.KEY].id,
    "self": makeSelfURL(trailheadEntity[Datastore.KEY].id, TRAILHEAD)
  }
}

// returns a user's information in JSON
// input: userEntity from datastore 
// output: object containing ID, properties, and self URL
function makeUserFormatJSON(userEntity) {
  return {
    "firstName": userEntity.firstName,
    "lastName": userEntity.lastName,
    "userId": userEntity.userId,
    "id": userEntity[Datastore.KEY].id,
    "self": makeSelfURL(userEntity[Datastore.KEY].id, TRAILHEAD)
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
  } else if (type.name === 'User') {
    response = Promise.all(
      entities.map( async (user) => {
        return makeUserFormatJSON(user);
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

// get a single entity
// input: type of entity (e.g. TRAIL, TRAILHEAD); headers (includes user's JWT and Accept)
// errors: user can't be authenticated; user doesn't own this entity; entity can't be found 
// output on success: entity data formatted by its type in JSON
async function getEntity(id, type, headers) {
  // must accept JSON response
  if (acceptTypeIsNotJSON(headers)) { 
    return acceptTypeError;
  }

  let userData = null;
  let entity = null;

  // if this entity is protected, authenticate the user, then get entity that belongs to that user; otherwise just query by entity ID
  if (type.protected) {
    userData = await verifyUser(headers.authorization).catch(error => console.log("error authenticating user", error));

    if (userData === false) {
      return userNotAuthenticatedError;
    }

    // if it doesn't exist or user doesn't own it -> 403
    entity = await getEntityFromDatastore(id, type, userData.payload.sub).catch(error => console.log(error));
    if (!entity) {
      return forbiddenError;
    }
  } else {
    // if it doesn't exist -> 404 (not protected)
    entity = await getEntityFromDatastore(id, type, null).catch(error => console.log(error));
    if (!entity) {
      return doesNotExistError;
    }
  }

  // make response object,
  const response = {
    "code": 200,
    "data": {}
  }
  
  // format reseponse items according to type (makeResponseByType takes and returns an array - may change later)
  const formattedArray = await makeResponseByType(type, [entity]).catch(error => console.log(error));
  response.data = formattedArray[0];

  return response;
}

// get page of results for a type of entity
// input: type of entity (e.g. TRAIL, TRAILHEAD); if nextPageCursor is defined, results start at that page
// output: array of formatted items; next URL contains next page of results, if it exists
async function getEntitiesPagination(type, headers, nextPageCursor) {
  // must accept JSON response
  if (acceptTypeIsNotJSON(headers)) { 
    return acceptTypeError;
  }

  // all responses get code 200; data will hold items, self URL, and next URL if needed
  const response = {
    "code": 200,
    "data": {}
  }

  let userData = null;

  // if this entity is protected, authenticate the user
  if (type.protected) {
    userData = await verifyUser(headers.authorization).catch(error => console.log("error authenticating user", error));

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

/*** route functions ***/

// posts new item. client must send all required attributes for item in body.
// input: name and type (strings); length (int)
// output on success: returns code 201 and formatted boat data if successful (name, type, length, ID, and self URL)
// error: 400 if name, type, or length are missing; 401 if user can't be authenticated by ID token
async function postEntity(type, headers, body){
  // must accept JSON response
  if (acceptTypeIsNotJSON(headers)) { 
    return acceptTypeError;
  }

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
    const userData = await verifyUser(headers.authorization).catch(error => console.log("error authenticating user", error));

    if (userData === false) {
      return userNotAuthenticatedError;
    }

    newEntity.userId = userData.payload.sub;
  }

  // set all required attributes for this type
  for (const attr of type.requiredAttributes) {
    newEntity[attr] = body[attr];
  }

  // set all other attributes for this type to empty arrays
  for (const attr of type.otherAttributes) {
    newEntity[attr] = [];
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
async function putEntity(id, type, headers, body) {
  // must accept JSON response
  if (acceptTypeIsNotJSON(headers)) { 
    return acceptTypeError;
  }

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
  let entity = null;

  // if item is protected, return error if user can't be authenticated; add userId to updatedEntity to return to client
  if (type.protected) {
    userData = await verifyUser(headers.authorization).catch(error => console.log("error authenticating user", error));

    if (userData === false) {
      return userNotAuthenticatedError;
    }

    updatedEntity.data.userId = userData.payload.sub;
    entity = await getEntityFromDatastore(id, type, userData.payload.sub).catch(error => console.log(error));
    if (!entity) {
      return forbiddenError;
    }
  } else {
    entity = await getEntityFromDatastore(id, type, null).catch(error => console.log(error));
    if (!entity) {
      return doesNotExistError;
    }
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

  // also set any other attributes (such as trail or trailhead array)
  for (const attr of type.otherAttributes) {
    updatedEntity.data[attr] = entity[attr];
  }

  return updatedEntity;
}

// patch an existing entity - only those attributes provided in body will be replaced
// input: ID, type, and data to update
// output: error if entity doesn't exist; otherwise updates datastore and returns object of data, ID, self URL, and status code
async function patchEntity(id, type, headers, body) {
  // must accept JSON response
  if (acceptTypeIsNotJSON(headers)) { 
    return acceptTypeError;
  }

  // will save changes to this object
  let updatedEntity = {
    "code": 200,
    "data": {}
  };

  let userData = null;
  let entity = null;

  // if item is protected, return error if user can't be authenticated; otherwise set userID
  if (type.protected) {
    userData = await verifyUser(headers.authorization).catch(error => console.log("error authenticating user", error));

    if (userData === false) {
      return userNotAuthenticatedError;
    }

    updatedEntity.data.userId = userData.payload.sub;

    entity = await getEntityFromDatastore(id, type, userData.payload.sub).catch(error => console.log(error));
    if (!entity) {
      return forbiddenError;
    }
  } else {
    entity = await getEntityFromDatastore(id, type, null).catch(error => console.log(error));
    if (!entity) {
      return doesNotExistError;
    }
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

  // also set any other attributes (such as trail or trailhead array)
  for (const attr of type.otherAttributes) {
    updatedEntity.data[attr] = entity[attr];
  }

  return updatedEntity;
}

// removes any relationships that a trail or trailhead has with other trails/trailheads. use this before deleting a trail or trailhead
// input: entity to remove relationships from and its type (TRAIL, TRAILHEAD)
// output: removes this entity's ID from all other related entities
async function removeRelationships(entity, type) {
  if (type === TRAIL) {
    for (const trailheadId of entity.trailheads) {
      let trailheadEntity = await getEntityFromDatastore(trailheadId, TRAILHEAD, null).catch(error => console.log(error));
      
      trailheadEntity.trails = trailheadEntity.trails.filter(trailId => {
        return trailId != entity[Datastore.KEY].id;
      });

      await datastore.update(trailheadEntity).catch(error => console.log(error));
    }
  } else if (type === TRAILHEAD) {
    for (const trailId of entity.trails) {
      const trailEntity = await getEntityFromDatastore(trailId, TRAIL, null).catch(error => console.log(error));

      trailEntity.trailheads = trailEntity.trailheads.filter(trailheadId => {
        return trailheadId != entity[Datastore.KEY].id;
      });

      await datastore.update(trailEntity).catch(error => console.log(error));
    }
  }
}

// delete an existing entity; if it's protected, it authenticates the user and checks if the user owns the entity
// input: trailId to delete
// output on success: code 204 after entity is deleted
// output on error: code 403 if user doesn't own the entity; 404 if entity doesn't exist
async function deleteEntity(id, type, headers) {
  // must accept JSON response
  if (acceptTypeIsNotJSON(headers)) { 
    return acceptTypeError;
  }

  let entity = null;

  // if the entity is protected, authenticate user and verify they own it; otherwise return error
  if (type.protected) {
    const userData = await verifyUser(headers.authorization).catch(error => console.log("error authenticating user", error));

    if (userData === false) {
      return userNotAuthenticatedError;
    } 

    entity = await getEntityFromDatastore(id, type, userData.payload.sub).catch(error => console.log(error));
    if (!entity) {
      return forbiddenError;
    }
  } else {
    entity = await getEntityFromDatastore(id, type, null).catch(error => console.log(error));
    if (!entity) {
      return doesNotExistError;
    }
  }

  // check if entity is related to any other entities
  removeRelationships(entity, type);

  // delete entity
  const key = entity[Datastore.KEY];
  await datastore.delete(key).catch(error => console.log(error));

  return {
    "code": 204,
    "data": {}
  }
}

// adds trailhead to trail, if the authenticated user owns that trail
// input: trailId and trailheadId
// output on error: if user can't be authenticated; if trail or trailhead doesn't exist; if user doesn't own trail
// output on success: trailhead ID is added to trail; trail ID is added to trailhead; returns 204 and no body
async function assignTrailheadToTrail(trailId, trailheadId, headers) { 
  // must accept JSON response
  if (acceptTypeIsNotJSON(headers)) { 
    return acceptTypeError;
  }

  // error if user can't be authenticated 
  const userData = await verifyUser(headers.authorization).catch(error => console.log("error authenticating user", error));

  if (userData === false) {
    return userNotAuthenticatedError;
  }

  // get trail and trailhead from datastore (only finds trails that belong to this user)
  const trailEntity = await getEntityFromDatastore(trailId, TRAIL, userData.payload.sub).catch(error => console.log(error));
  const trailheadEntity = await getEntityFromDatastore(trailheadId, TRAILHEAD, null).catch(error => console.log(error));

  // error if trail or trailhead doesn't exist, or if user doesn't own it; or if trailhead is already assigned to that trail
  if (!trailEntity) {
    return forbiddenError;
  } else if (!trailheadEntity) {
    return doesNotExistError;
  } else if (trailEntity.trailheads.includes(trailheadEntity[Datastore.KEY].id) && trailheadEntity.trails.includes(trailEntity[Datastore.KEY].id)){
    return alreadyExistsError;
  } 

  // add trail ID to trailhead and trailhead ID to trail; update in datastore
  trailEntity.trailheads.push(trailheadEntity[Datastore.KEY].id);
  trailheadEntity.trails.push(trailEntity[Datastore.KEY].id);

  await datastore.update(trailEntity).catch(error => console.log(error));
  await datastore.update(trailheadEntity).catch(error => console.log(error));

  console.log("added relationship");
  console.log("trailEntity: ", trailEntity);
  console.log("trailheadEntity: ", trailheadEntity);

  return {
    "code": 204,
    "data": {}
  }
}

// removes trailhead to trail, if the authenticated user owns that trail
// input: trailId and trailheadId
// output on error: if user can't be authenticated; if trail or trailhead doesn't exist; if user doesn't own trail
// output on success: trailhead ID is added to trail; trail ID is added to trailhead; returns 204 and no body
async function removeTrailheadFromTrail(trailId, trailheadId, headers) { 
  // must accept JSON response
  if (acceptTypeIsNotJSON(headers)) { 
    return acceptTypeError;
  }

  // error if user can't be authenticated 
  const userData = await verifyUser(headers.authorization).catch(error => console.log("error authenticating user", error));

  if (userData === false) {
    return userNotAuthenticatedError;
  }

  // get trail and trailhead from datastore (only gets trail that belongs to user)
  const trailEntity = await getEntityFromDatastore(trailId, TRAIL, userData.payload.sub).catch(error => console.log(error));
  const trailheadEntity = await getEntityFromDatastore(trailheadId, TRAILHEAD, null).catch(error => console.log(error));

  // error if trail or trailhead doesn't exist, or doesn't belong to this user; or if trailhead isn't already assigned to trail and vice versa
  if (!trailEntity) {
    return forbiddenError;
  } else if (!trailheadEntity) {
    return doesNotExistError;  
  } else if (!(trailEntity.trailheads.includes(trailheadEntity[Datastore.KEY].id)) && !(trailheadEntity.trails.includes(trailEntity[Datastore.KEY].id))){
    return relationshipDoesNotExistError;
  } 

  // removes trail ID from trailhead and trailhead ID from trail; updates both in datastore
  trailEntity.trailheads = trailEntity.trailheads.filter(value => {
    return value !== trailheadId;
  });
  trailheadEntity.trails = trailheadEntity.trails.filter(value => {
    return value !== trailId;
  });
  
  await datastore.update(trailEntity).catch(error => console.log(error));
  await datastore.update(trailheadEntity).catch(error => console.log(error));

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

  // if user hasn't bee added to USERS before, add them 
  const userQuery = datastore.createQuery(USER.name).filter('userId', '=', sub)
  const results = await datastore.runQuery(userQuery).catch(error => console.log(error));

  // if no results, add user to datastore
  if (results[0].length === 0) {
    const newUser = {
      firstName: userData.names[0].givenName,
      lastName: userData.names[0].familyName,
      userId: sub
    };

    // save new user info to datastore
    const key = datastore.key(USER.name);
    
    await datastore.save({ "key": key, "data": newUser })
      .catch(error => {
        console.log("error saving to datastore: ", error)
      });
  }
  
  // format data to send to web page
  responseData.firstName = userData.names[0].givenName;
  responseData.lastName = userData.names[0].familyName;
  responseData.jwt = tokens.id_token;
  responseData.userID = sub;

  res.render("user.html", responseData);
});

// returns a trail by its ID that is owned by the authenticated user
app.get('/trails/:trailId', async function(req, res){
  const result = await getEntity(req.params.trailId, TRAIL, req.headers);
  res.status(result.code).send(result.data);
});

// returns a trailhead by its ID (no authentication needed)
app.get('/trailheads/:trailheadId', async function(req, res){
  const result = await getEntity(req.params.trailheadId, TRAILHEAD, req.headers);
  res.status(result.code).send(result.data);
});

// returns array of all trails that are owned by the authenticated user, with pagination
app.get('/trails', async function(req, res){
  const result = await getEntitiesPagination(TRAIL, req.headers, req.query.nextPage);
  res.status(result.code).send(result.data);
});

// returns array of all trailheads, with pagination
app.get('/trailheads', async function(req, res){
  const result = await getEntitiesPagination(TRAILHEAD, req.headers, req.query.nextPage);
  res.status(result.code).send(result.data);
});

// creates new trail if all data is provided in body; request and response must be JSON; otherwise error message
app.post('/trails', async(req, res) => {
  const result = await postEntity(TRAIL, req.headers, req.body).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// creates new trailhead if all data is provided in body; request and response must be JSON; otherwise error message
app.post('/trailheads', async(req, res) => {
  const result = await postEntity(TRAILHEAD, req.headers, req.body).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// replaces existing trails's information with that provided in body
app.put("/trails/:trailId", async(req, res) => {
  const result = await putEntity(req.params.trailId, TRAIL, req.headers, req.body).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// replaces existing trailhead's information with that provided in body
app.put("/trailheads/:trailheadId", async(req, res) => {
  const result = await putEntity(req.params.trailheadId, TRAILHEAD, req.headers, req.body).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// edits some or all of a trails's information
app.patch("/trails/:trailId", async(req, res) => {
  const result = await patchEntity(req.params.trailId, TRAIL, req.headers, req.body).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// edits some or all of a trailheads's information
app.patch("/trailheads/:trailheadId", async(req, res) => {
  const result = await patchEntity(req.params.trailheadId, TRAILHEAD, req.headers, req.body).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// deletes a trail from datastore if the authenticated user owns it
app.delete("/trails/:trailId", async(req, res) => {
  const result = await deleteEntity(req.params.trailId, TRAIL, req.headers).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// deletes a trailhead from datastore. also removes it from any trail it is assigned to. no authentication
app.delete("/trailheads/:trailheadId", async(req, res) => {
  const result = await deleteEntity(req.params.trailheadId, TRAILHEAD, req.headers).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// can't get a trail's trailheads directoy -> 405 error
app.put('/trails/:trailId/trailheads/:trailheadId', async(req, res) => {
  const result = await assignTrailheadToTrail(req.params.trailId, req.params.trailheadId, req.headers).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// adds a trailhead to a trail, if the authenticated user owns that trail
app.put('/trails/:trailId/trailheads/:trailheadId', async(req, res) => {
  const result = await assignTrailheadToTrail(req.params.trailId, req.params.trailheadId, req.headers).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// removes a trailhead from a trail, if the authenticated user owns that trail
app.delete('/trails/:trailId/trailheads/:trailheadId', async(req, res) => {
  const result = await removeTrailheadFromTrail(req.params.trailId, req.params.trailheadId, req.headers).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// returns userId, first name, adn last name of all users (no authentication required)
app.get('/users', async(req, res) => {
  const result = await getEntitiesPagination(USER, req.headers, req.query.nextPage).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// no other methods allowed for /trails
app.all('/trails', async(req, res) => {
  const result = methodNotAllowedError;
  res.setHeader('Allow', 'GET, POST')
  res.status(result.code).send(result.data);
});

// no other methods allowed for /trailheads
app.all('/trailheads', async(req, res) => {
  const result = methodNotAllowedError;
  res.setHeader('Allow', 'GET, POST')
  res.status(result.code).send(result.data);
});

// no other methods allowed for /users
app.all('/users', async(req, res) => {
  const result = methodNotAllowedError;
  res.setHeader('Allow', 'GET')
  res.status(result.code).send(result.data);
});

// listen to GAE port if it exists; 8001 otherwise
const PORT = process.env.PORT || 8001;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});
