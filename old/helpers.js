function numberWithCommas(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function extractNumberFromString(string) {
    const str = string.match(/\d+\,\d+|\d+\b|\d+(?=\w)/g);

    if (!str) return null;
    //if string number contains commas
    if (string.indexOf(',') > -1) { 
      return str[0];
     } else {
      return numberWithCommas(parseInt(str[0]));
     }
}

function findMatchedElement($, selector, matcher) {
  return $(selector).filter(function () {
    const reg = new RegExp(matcher, "ig");
    return reg.test($(this).text());
  });
}

function isBeforeToday(date) {
  const today = new Date();

  today.setHours(0, 0, 0, 0);

  return date < today;
}

function updateURLParameter(url, param, paramVal){
    var newAdditionalURL = "";
    var tempArray = url.split("?");
    var baseURL = tempArray[0];
    var additionalURL = tempArray[1];
    var temp = "";
    if (additionalURL) {
        tempArray = additionalURL.split("&");
        for (var i=0; i<tempArray.length; i++){
            if(tempArray[i].split('=')[0] != param){
                newAdditionalURL += temp + tempArray[i];
                temp = "&";
            }
        }
    }

    var rows_txt = temp + "" + param + "=" + paramVal;
    return baseURL + "?" + newAdditionalURL + rows_txt;
}

const helpers = {
  numberWithCommas,
  extractNumberFromString,
  findMatchedElement,
  isBeforeToday,
  updateURLParameter
}

module.exports = helpers;