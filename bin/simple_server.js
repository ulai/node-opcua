"use strict";
Error.stackTraceLimit = Infinity;

var argv = require('yargs')
    .wrap(132)
    .string("alternateHostname")
    .describe("alternateHostname")
    .alias('a','alternateHostname')
    .argv;

var opcua = require("..");
var _ = require("underscore");
var OPCUAServer = opcua.OPCUAServer;
var Variant = opcua.Variant;
var DataType = opcua.DataType;


var address_space_for_conformance_testing = require("../lib/simulation/address_space_for_conformance_testing");
var build_address_space_for_conformance_testing = address_space_for_conformance_testing.build_address_space_for_conformance_testing;

var install_optional_cpu_and_memory_usage_node = require("../lib/server/vendor_diagnostic_nodes").install_optional_cpu_and_memory_usage_node;

var standard_nodeset_file = opcua.standard_nodeset_file;

var get_fully_qualified_domain_name = require("../lib/misc/hostname").get_fully_qualified_domain_name;


var server_options ={

    port: 26543,
    resourcePath: "UA/Server",

    nodeset_filename: [ standard_nodeset_file],

    serverInfo: {
        applicationUri : "urn:"+ get_fully_qualified_domain_name(35)+ ":NodeOPCUA-Server",
        productUri:      "NodeOPCUA-SimpleDemoServer",
        applicationName: {text: "applicationName"},
        gatewayServerUri: null,
        discoveryProfileUri: null,
        discoveryUrls: []
    },
    buildInfo: {
        buildNumber: "1234"
    },
    serverCapabilities: {
        operationLimits: {
            maxNodesPerRead: 1000,
            maxNodesPerBrowse: 2000
        }
    }
};
server_options.alternateHostname = argv.alternateHostname;

var server = new OPCUAServer(server_options);

var endpointUrl = server.endpoints[0].endpointDescriptions()[0].endpointUrl;

var hostname = require("os").hostname();

var discovery_server_endpointUrl = "opc.tcp://" + hostname + ":4840/UADiscovery";

console.log("\nregistering server to :".yellow + discovery_server_endpointUrl);

server.registerServer(discovery_server_endpointUrl, function (err) {
    if (err) {
        // cannot register server in discovery
        console.log("     warning : cannot register server into registry server".cyan);
    } else {
        console.log("     registering server to the discovery server : done.".cyan);
    }
    console.log("");
});



server.on("post_initialize", function () {

    build_address_space_for_conformance_testing(server.engine);

    install_optional_cpu_and_memory_usage_node(server);

    var myDevices = server.engine.createFolder("Objects", { browseName: "MyDevices"});

    /**
     * variation 1:
     * ------------
     *
     * Add a variable in folder using a single get function witch returns the up to date variable value in Variant.
     * The server will set the timestamps automatically for us.
     *
     */
    server.engine.addVariableInFolder(myDevices, {
        browseName: "PumpSpeed",
        nodeId: "ns=2;s=PumpSpeed",
        dataType: "Double",
        value: {
            /**
             * returns the  current value as a Variant
             * @method get
             * @return {Variant}
             */
            get: function () {
                var pump_speed = 200 + 100 * Math.sin(Date.now() / 10000);
                return new Variant({dataType: DataType.Double, value: pump_speed});
            }
        }
    });

    server.engine.addVariableInFolder(myDevices, {
        browseName: "SomeDate",
        nodeId: "ns=2;s=SomeDate",
        dataType: "DateTime",
        value: {
            get: function () {
                return new Variant({dataType: DataType.DateTime, value: new Date(Date.UTC(2016, 9, 13, 8, 40, 0))});
            }
        }
    });


    /**
     * variation 2:
     * ------------
     *
     * Add a variable in folder. This variable gets its value and source timestamps from the provided function.
     * The value and source timestamps are held in a external object.
     * The value and source timestamps are updated on a regular basis using a timer function.
     */
    var external_value_with_sourceTimestamp = {
        value: new Variant({dataType: DataType.Double , value: 10.0}),
        sourceTimestamp : null,
        sourcePicoseconds: 0
    };
    setInterval(function() {
        external_value_with_sourceTimestamp.value.value = Math.random();
        external_value_with_sourceTimestamp.sourceTimestamp = new Date();
    },1000);

    server.engine.addVariableInFolder(myDevices, {
        browseName: "Pressure",
        nodeId: "ns=2;s=Pressure",
        dataType: "Double",
        value: {
            timestamped_get: function () {
                return external_value_with_sourceTimestamp;
            }
        }
    });


    /**
     * variation 3:
     * ------------
     *
     * Add a variable in a folder. This variable gets its value  and source timestamps from the provided asynchronous
     * function.
     * The asynchronous function is called only when needed by the opcua Server read services and monitored item services
     *
     */

    server.engine.addVariableInFolder(myDevices, {
        browseName: "Temperature",
        nodeId: "ns=2;s=Temperature",
        dataType: "Double",

        value: {
            refreshFunc: function (callback) {

                var temperature = 20 + 10 * Math.sin(Date.now() / 10000);
                var value = new Variant({dataType: DataType.Double, value: temperature});
                var sourceTimestamp = new Date();

                // simulate a asynchronous behaviour
                setTimeout(function () {
                    callback(null, value, sourceTimestamp);
                }, 100);
            }
        }
    });


});

function w(str,width) { return (str+ "                            ").substr(0,width);}

function dumpObject(obj) {
 return   _.map(obj,function(value,key) {
     return  w("          " + key,30).green + "       : " + ((value === null)? null : value.toString());
 }).join("\n");
}




server.start(function (err) {
    if (err) {
        console.log(" Server failed to start ... exiting");
        process.exit(-3);
    }
    console.log("  server PID          :".yellow, process.pid);
    console.log("  server on port      :".yellow, server.endpoints[0].port.toString().cyan);
    console.log("  endpointUrl         :".yellow, endpointUrl.cyan);

    console.log("  serverInfo          :".yellow);
    console.log(dumpObject(server.serverInfo));
    console.log("  buildInfo           :".yellow);
    console.log(dumpObject(server.engine.buildInfo));

    console.log("\n  server now waiting for connections. CTRL+C to stop".yellow);
});


server.on("request", function (request) {
    console.log(request._schema.name);
    switch (request._schema.name) {
        case "ReadRequest":
            var str = "";
            request.nodesToRead.map(function (node) {
                str += node.nodeId.toString() + " " + node.attributeId + " ";
            });
            console.log(str);
            break;
        case "TranslateBrowsePathsToNodeIdsRequest":
            // do special console output
            //xx console.log(util.inspect(request, {colors: true, depth: 10}));
            break;
    }
});

process.on('SIGINT', function() {
    // only work on linux apparently
    console.log(" Received server interruption from user ".red.bold);
    console.log(" shutting down ".red.bold);
    server.shutdown(function () {
        console.log(" done ".red.bold);
        process.exit(-1);
    });
});
