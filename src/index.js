const {
  BaseKonnector,
  requestFactory,
  scrape,
  log
} = require('cozy-konnector-libs')
const request = requestFactory({
  // The debug mode shows all the details about HTTP requests and responses. Very useful for
  // debugging but very verbose. This is why it is commented out by default
  // debug: true,
  // Activates [cheerio](https://cheerio.js.org/) parsing on each page
  cheerio: true,
  // If cheerio is activated do not forget to deactivate json parsing (which is activated by
  // default in cozy-konnector-libs
  json: false,
  // This allows request-promise to keep cookies between requests
  jar: true
})

const VENDOR = 'mint-energie'
const baseUrl = 'https://www.mint-energie.com'

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
// cozyParameters are static parameters, independents from the account. Most often, it can be a
// secret api key.
async function start(fields, cozyParameters) {
  log('info', 'Authenticating ...')
  if (cozyParameters) log('debug', 'Found COZY_PARAMETERS')
  await authenticate.bind(this)(fields.login, fields.password)
  log('info', 'Successfully logged in')
  // The BaseKonnector instance expects a Promise as return of the function
  log('info', 'Fetching the list of documents')
  const $ = await request(`${baseUrl}/Pages/Compte/informations_paiement.aspx`)
  // cheerio (https://cheerio.js.org/) uses the same api as jQuery (http://jquery.com/)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)

  // Here we use the saveBills function even if what we fetch are not bills,
  // but this is the most common case in connectors
  log('info', 'Saving data to Cozy')
  await this.saveBills(documents, fields, {
    // This is a bank identifier which will be used to link bills to bank operations. These
    // identifiers should be at least a word found in the title of a bank operation related to this
    // bill. It is not case sensitive.
    identifiers: ['budget telecom']
  })
}

// This shows authentication using the [signin function](https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#module_signin)
// even if this in another domain here, but it works as an example
function authenticate(username, password) {
  return this.signin({
    url: `${baseUrl}/Pages/Connexion/connexion.aspx`,
    formSelector: 'form',
    formData: {
      TB_Login: username,
      TB_Password: password,
      BT_Connexion: 'se connecter'
    },
    // The validate function will check if the login request was a success. Every website has a
    // different way to respond: HTTP status code, error message in HTML ($), HTTP redirection
    // (fullResponse.request.uri.href)...
    validate: (statusCode, $, fullResponse) => {
      log(
        'debug',
        fullResponse.request.uri.href,
        'not used here but should be useful for other connectors'
      )
      // The login in toscrape.com always works except when no password is set
      if ($(`#header1_LB_Exit`).length === 1) {
        return true
      } else {
        // cozy-konnector-libs has its own logging function which format these logs with colors in
        // standalone and dev mode and as JSON in production mode
        log('error', $('.error').text())
        return false
      }
    }
  })
}

// The goal of this function is to parse a HTML page wrapped by a cheerio instance
// and return an array of JS objects which will be saved to the cozy by saveBills
// (https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#savebills)
async function parseDocuments($) {
  // You can find documentation about the scrape function here:
  // https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#scrape
  const docs = await scrape(
    $,
    {
      date: {
        sel: 'div.colA b:nth-child(1)',
        parse: toEPoch
      },
      amount: {
        sel: 'div.colB b:nth-child(1)',
        parse: normalizePrice
      },
      fileurl: {
        sel: 'div.colC a',
        attr: 'href'
      }
    },
    '.factulist'
  )
  return docs.map(doc => ({
    ...doc,
    currency: 'EUR',
    filename: `${extractStringDate(doc.date)}_${VENDOR}_${doc.amount.toFixed(
      2
    )}EUR${doc.vendorRef ? '_' + doc.vendorRef : ''}.pdf`,
    vendor: VENDOR
  }))
}

// Convert a price string to a float
function normalizePrice(price) {
  return parseFloat(price.replace('€', '').trim())
}

function toEPoch(date) {
  let d = date.split('/')
  return new Date(d[2] + '-' + d[1] + '-' + d[0] + 'T12:00:00')
}

// Convert Date object to a string like '2020-06-17'
function extractStringDate(date) {
  // We need to add leading 0 to month and day
  const month = ('00' + (date.getMonth() + 1)).slice(-2) // January = 0
  const day = ('00' + date.getDate()).slice(-2)
  return `${date.getFullYear()}` + `-${month}` + `-${day}`
}
