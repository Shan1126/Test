const express = require("express");
var request = require("request");
var cronParser = require("cron-parser");
const router = express.Router();
var config = require("./../config.json");
const logger = require("../logger/simple-logger");
const jenkins = require("jenkins")({
  baseUrl: process.env.jenkins_url,
  crumbIssuer: true
});

router.get("/:name", getJobByName);
router.post("/", getNextRunTime);
router.get("/:name/:buildNumber", getBuildDetails);
router.get("/", getAllJobs);
router.post('/:name', buildJob);
router.get("/:name/:buildNumber/log", getConsoleLog);


module.exports = router;

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

function getConsoleLog(req, res) {
  logger.writeInfoLog(`Getting consolelog details of ${req.params.name} # ${req.params.buildNumber} for user:  
  ${req.decoded.firstName}, ${req.decoded.lastName} [${req.decoded.userId}]`);
  jenkins.build.log(req.params.name, req.params.buildNumber, function(
      err,
      data
    ) {
      if (err) {
        logger.writeInfoLog('Error occurred while getting logs: '+err);
      }
      res.status(200).send({ data: data });
    });
}


function getJobByName(req, res) {
  logger.writeInfoLog(`Getting job details of ${req.params.name} for user:  
  ${req.decoded.firstName}, ${req.decoded.lastName} [${req.decoded.userId}]`);
  if (req.params.name) {
    jenkins.job.get(req.params.name, { depth: 3 }, function(err, data) {
      if (err) {
        console.log(err);
      }
      res.status(200).send(data);
    });
  } else {
    res.status(200).send({});
  }
}
function getAllJobs(req, res) {
  logger.writeInfoLog(`Getting list of jobs for user:  
  ${req.decoded.firstName}, ${req.decoded.lastName} [${req.decoded.userId}]`);
  request(process.env.jenkins_url + config.getJobsUrl, function(
    error,
    response,
    body
  ) {
    if (body === undefined) {
      res.status(200).send({});
    } else {
      const b = JSON.parse(body);
      const jobs = b.jobs;
      var lst = [];
      var j = {};
      let successCount = 0;
      let failureCount = 0;
      jobs.forEach(j => {
        if (j.jobs) {
          j.jobs.forEach(h => {
            if (h.jobs) {
              h.jobs.forEach(i => {
                if (config.allowedApps.includes(i.name)) {
                  if (i.builds) {
                    var string = i.builds[0].url;
                    i.builds.forEach(s => {
                      if (s.result === "Success") {
                        successCount++;
                      }
                      if (s.result === "Failure") {
                        failureCount++;
                      }
                    });
                    i.jobUrl = string.substring(
                      0,
                      string
                        .substring(0, string.lastIndexOf("/") + 0)
                        .lastIndexOf("/") + 0
                    );
                    i.jobFullPath = i.jobUrl.replace(
                      /^[a-z]{4,5}\:\/{2}[a-z]{1,}\:[0-9]{1,4}.(.*)/,
                      "$1"
                    );
                  }
                  lst.push(i);
                }
              });
            }

            if (config.allowedApps.includes(h.name)) {
              if (h.builds) {
                h.builds.forEach(s => {
                  if (s.result === "Success") {
                    successCount++;
                  }
                  if (s.result === "Failure") {
                    failureCount++;
                  }
                });

                var string = h.builds[0].url;
                h.jobUrl = string.substring(
                  0,
                  string
                    .substring(0, string.lastIndexOf("/") + 0)
                    .lastIndexOf("/") + 0
                );
                h.jobFullPath = h.jobUrl.replace(
                  /^[a-z]{4,5}\:\/{2}[a-z]{1,}\:[0-9]{1,4}.(.*)/,
                  "$1"
                );
              }
              lst.push(h);
            }
          });
        }
        if (config.allowedApps.includes(j.name)) {
          if (j.builds) {
            var string = j.builds[0].url;
            j.jobUrl = string.substring(
              0,
              string
                .substring(0, string.lastIndexOf("/") + 0)
                .lastIndexOf("/") + 0
            );
            j.jobFullPath = j.jobUrl.replace(
              /^[a-z]{4,5}\:\/{2}[a-z]{1,}\:[0-9]{1,4}.(.*)/,
              "$1"
            );
            j.builds.forEach(s => {
              if (s.result === "SUCCESS") {
                successCount++;
              }
              if (s.result === "FAILURE") {
                failureCount++;
              }
            });
          }
          lst.push(j);
        }
      });
      j.jobs = lst;
      j.successCount = successCount;
      j.failureCount = failureCount;
      res.status(200).send(j);
    }
  });
}
function getNextRunTime(req, res) {
  var job = {};
  logger.writeInfoLog("Getting next run time for job: " + req.body.jobName);
  const exp = config.cronSpecs[req.body.jobName];
  logger.writeInfoLog("Expression for  " + req.body.jobName + "is:  " + exp);
  if (exp) {
    var interval = cronParser.parseExpression(exp);
    if (interval) job.nextTime = interval.next();
  }
  logger.writeInfoLog("Got next run time for job: " + req.body.jobName);
  res.status(200).send(job);
}

function getBuildDetails(req, res) {
  if (req.params.name) {
    jenkins.build.get(req.params.name, req.params.buildNumber, function(
      err,
      data
    ) {
      if (err) {
        return console.log(err);
      }
      res.status(200).send(data);
    });
  } else {
    res.status(200).send({});
  }
}

function buildJob(req, res) {
  logger.writeInfoLog(`Building job  ${req.body.jobName} for user:  
  ${req.decoded.firstName}, ${req.decoded.lastName} [${req.decoded.userId}]`);
  if (req.params.name) {
    logger.writeInfoLog("Building job: " + req.body.jobName);
    jenkins.job.build(req.body.name, function(err, id) {
      if (err) throw err;
      waitOnQueue(id);
      logger.writeInfoLog("job scheduled to start : " + req.body.jobName);
      res.status(200).send({ message: "Job has been started" });
    });
  } else {
    waitOnQueue(id);
    logger.writeInfoLog("job not scheduled to start : " + req.body.jobName);
    res.status(200).send({});
  }
}
function waitOnQueue(id) {
  jenkins.queue.item(id, function(err, item) {
    if (err) throw err;
    logger.writeInfoLog("queue", item);
    if (item.executable) {
      logger.writeInfoLog("number:", item.executable.number);
      return item.executable.number;
    } else if (item.cancelled) {
      logger.writeInfoLog("cancelled");
      return "canceled";
    } else {
      setTimeout(function() {
        waitOnQueue(id);
      }, 500);
    }
  });
}
