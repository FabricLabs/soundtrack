## Modules

<dl>
<dt><a href="#module_@services/soundtrack">@services/soundtrack</a></dt>
<dd><p>Implements the Soundtrack type.</p>
</dd>
</dl>

## Classes

<dl>
<dt><a href="#Interface">Interface</a> ⇐ <code>EventEmitter</code></dt>
<dd><p>Interfaces compile abstract contract code into <a href="#Chain">Chain</a>-executable transactions, or &quot;chaincode&quot;. For example, the &quot;Bitcoin&quot; interface might compile a Swap contract into Script, preparing a valid Bitcoin transaction for broadcast which executes the swap contract.</p>
</dd>
<dt><a href="#Chain">Chain</a></dt>
<dd><p>Chain.</p>
</dd>
<dt><a href="#State">State</a></dt>
<dd><p>The <a href="#State">State</a> is the core of most <a href="User">User</a>-facing interactions.  To
interact with the <a href="User">User</a>, simply propose a change in the state by
committing to the outcome.  This workflow keeps app design quite simple!</p>
</dd>
</dl>

<a name="module_@services/soundtrack"></a>

## @services/soundtrack
Implements the Soundtrack type.


* [@services/soundtrack](#module_@services/soundtrack)
    * [~Soundtrack](#module_@services/soundtrack..Soundtrack) ⇐ [<code>Interface</code>](#Interface)
        * [new Soundtrack([settings])](#new_module_@services/soundtrack..Soundtrack_new)
        * [.state](#Interface+state)
        * [.start()](#Interface+start)
        * [.stop()](#Interface+stop)
        * [.cycle(val)](#Interface+cycle)
        * [.log(...inputs)](#Interface+log)
        * [.now()](#Interface+now) ⇒ <code>Number</code>

<a name="module_@services/soundtrack..Soundtrack"></a>

### @services/soundtrack~Soundtrack ⇐ [<code>Interface</code>](#Interface)
**Kind**: inner class of [<code>@services/soundtrack</code>](#module_@services/soundtrack)  
**Extends**: [<code>Interface</code>](#Interface)  

* [~Soundtrack](#module_@services/soundtrack..Soundtrack) ⇐ [<code>Interface</code>](#Interface)
    * [new Soundtrack([settings])](#new_module_@services/soundtrack..Soundtrack_new)
    * [.state](#Interface+state)
    * [.start()](#Interface+start)
    * [.stop()](#Interface+stop)
    * [.cycle(val)](#Interface+cycle)
    * [.log(...inputs)](#Interface+log)
    * [.now()](#Interface+now) ⇒ <code>Number</code>

<a name="new_module_@services/soundtrack..Soundtrack_new"></a>

#### new Soundtrack([settings])
Create an instance of [Soundtrack](Soundtrack).


| Param | Type | Description |
| --- | --- | --- |
| [settings] | <code>Object</code> | List of options. |

<a name="Interface+state"></a>

#### soundtrack.state
Getter for [State](#State).

**Kind**: instance property of [<code>Soundtrack</code>](#module_@services/soundtrack..Soundtrack)  
<a name="Interface+start"></a>

#### soundtrack.start()
Start the [Interface](#Interface).

**Kind**: instance method of [<code>Soundtrack</code>](#module_@services/soundtrack..Soundtrack)  
<a name="Interface+stop"></a>

#### soundtrack.stop()
Stop the Interface.

**Kind**: instance method of [<code>Soundtrack</code>](#module_@services/soundtrack..Soundtrack)  
<a name="Interface+cycle"></a>

#### soundtrack.cycle(val)
Ticks the clock with a named [Cycle](Cycle).

**Kind**: instance method of [<code>Soundtrack</code>](#module_@services/soundtrack..Soundtrack)  

| Param | Type | Description |
| --- | --- | --- |
| val | <code>String</code> | Name of cycle to scribe. |

<a name="Interface+log"></a>

#### soundtrack.log(...inputs)
Log some output to the console.

**Kind**: instance method of [<code>Soundtrack</code>](#module_@services/soundtrack..Soundtrack)  

| Param | Type | Description |
| --- | --- | --- |
| ...inputs | <code>any</code> | Components of the message to long.  Can be a single {@link} String, many [String](String) objects, or anything else. |

<a name="Interface+now"></a>

#### soundtrack.now() ⇒ <code>Number</code>
Returns current timestamp.

**Kind**: instance method of [<code>Soundtrack</code>](#module_@services/soundtrack..Soundtrack)  
<a name="Interface"></a>

## Interface ⇐ <code>EventEmitter</code>
Interfaces compile abstract contract code into [Chain](#Chain)-executable transactions, or "chaincode". For example, the "Bitcoin" interface might compile a Swap contract into Script, preparing a valid Bitcoin transaction for broadcast which executes the swap contract.

**Kind**: global class  
**Extends**: <code>EventEmitter</code>  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| status | <code>String</code> | Human-friendly value representing the Interface's current [State](#State). |


* [Interface](#Interface) ⇐ <code>EventEmitter</code>
    * [new Interface(settings)](#new_Interface_new)
    * [.state](#Interface+state)
    * [.start()](#Interface+start)
    * [.stop()](#Interface+stop)
    * [.cycle(val)](#Interface+cycle)
    * [.log(...inputs)](#Interface+log)
    * [.now()](#Interface+now) ⇒ <code>Number</code>

<a name="new_Interface_new"></a>

### new Interface(settings)
Define an [Interface](#Interface) by creating an instance of this class.

**Returns**: [<code>Interface</code>](#Interface) - Instance of the [Interface](#Interface).  

| Param | Type | Description |
| --- | --- | --- |
| settings | <code>Object</code> | Configuration values. |

<a name="Interface+state"></a>

### interface.state
Getter for [State](#State).

**Kind**: instance property of [<code>Interface</code>](#Interface)  
<a name="Interface+start"></a>

### interface.start()
Start the [Interface](#Interface).

**Kind**: instance method of [<code>Interface</code>](#Interface)  
<a name="Interface+stop"></a>

### interface.stop()
Stop the Interface.

**Kind**: instance method of [<code>Interface</code>](#Interface)  
<a name="Interface+cycle"></a>

### interface.cycle(val)
Ticks the clock with a named [Cycle](Cycle).

**Kind**: instance method of [<code>Interface</code>](#Interface)  

| Param | Type | Description |
| --- | --- | --- |
| val | <code>String</code> | Name of cycle to scribe. |

<a name="Interface+log"></a>

### interface.log(...inputs)
Log some output to the console.

**Kind**: instance method of [<code>Interface</code>](#Interface)  

| Param | Type | Description |
| --- | --- | --- |
| ...inputs | <code>any</code> | Components of the message to long.  Can be a single {@link} String, many [String](String) objects, or anything else. |

<a name="Interface+now"></a>

### interface.now() ⇒ <code>Number</code>
Returns current timestamp.

**Kind**: instance method of [<code>Interface</code>](#Interface)  
<a name="Chain"></a>

## Chain
Chain.

**Kind**: global class  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| name | <code>String</code> | Current name. |
| indices | <code>Map</code> |  |
| ledger | <code>Ledger</code> |  |
| storage | <code>Storage</code> |  |

<a name="new_Chain_new"></a>

### new Chain(genesis)
Holds an immutable chain of events.


| Param | Type | Description |
| --- | --- | --- |
| genesis | <code>Vector</code> | Initial state for the chain of events. |

<a name="State"></a>

## State
The [State](#State) is the core of most [User](User)-facing interactions.  To
interact with the [User](User), simply propose a change in the state by
committing to the outcome.  This workflow keeps app design quite simple!

**Kind**: global class  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| size | <code>Number</code> | Size of state in bytes. |
| @buffer | <code>Buffer</code> | Byte-for-byte memory representation of state. |
| @type | <code>String</code> | Named type. |
| @data | <code>Mixed</code> | Local instance of the state. |
| @id | <code>String</code> | Unique identifier for this data. |


* [State](#State)
    * [new State(data)](#new_State_new)
    * _instance_
        * [.toString()](#State+toString) ⇒ <code>String</code>
        * [.serialize([input])](#State+serialize) ⇒ <code>Buffer</code>
        * [.deserialize(input)](#State+deserialize) ⇒ [<code>State</code>](#State)
        * [.fork()](#State+fork) ⇒ [<code>State</code>](#State)
        * [.get(path)](#State+get) ⇒ <code>Mixed</code>
        * [.set(path)](#State+set) ⇒ <code>Mixed</code>
        * [.commit()](#State+commit)
        * [.render()](#State+render) ⇒ <code>String</code>
    * _static_
        * [.fromJSON(input)](#State.fromJSON) ⇒ [<code>State</code>](#State)

<a name="new_State_new"></a>

### new State(data)
Creates a snapshot of some information.

**Returns**: [<code>State</code>](#State) - Resulting state.  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>Mixed</code> | Input data. |

<a name="State+toString"></a>

### state.toString() ⇒ <code>String</code>
Unmarshall an existing state to an instance of a [Blob](Blob).

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>String</code> - Serialized [Blob](Blob).  
<a name="State+serialize"></a>

### state.serialize([input]) ⇒ <code>Buffer</code>
Convert to [Buffer](Buffer).

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>Buffer</code> - [Store](Store)-able blob.  

| Param | Type | Description |
| --- | --- | --- |
| [input] | <code>Mixed</code> | Input to serialize. |

<a name="State+deserialize"></a>

### state.deserialize(input) ⇒ [<code>State</code>](#State)
Take a hex-encoded input and convert to a [State](#State) object.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: [<code>State</code>](#State) - [description]  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | [description] |

<a name="State+fork"></a>

### state.fork() ⇒ [<code>State</code>](#State)
Creates a new child [State](#State), with `@parent` set to
the current [State](#State) by immutable identifier.

**Kind**: instance method of [<code>State</code>](#State)  
<a name="State+get"></a>

### state.get(path) ⇒ <code>Mixed</code>
Retrieve a key from the [State](#State).

**Kind**: instance method of [<code>State</code>](#State)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="State+set"></a>

### state.set(path) ⇒ <code>Mixed</code>
Set a key in the [State](#State) to a particular value.

**Kind**: instance method of [<code>State</code>](#State)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>Path</code> | Key to retrieve. |

<a name="State+commit"></a>

### state.commit()
Increment the vector clock, broadcast all changes as a transaction.

**Kind**: instance method of [<code>State</code>](#State)  
<a name="State+render"></a>

### state.render() ⇒ <code>String</code>
Compose a JSON string for network consumption.

**Kind**: instance method of [<code>State</code>](#State)  
**Returns**: <code>String</code> - JSON-encoded [String](String).  
<a name="State.fromJSON"></a>

### State.fromJSON(input) ⇒ [<code>State</code>](#State)
Marshall an input into an instance of a [State](#State).  States have
absolute authority over their own domain, so choose your States wisely.

**Kind**: static method of [<code>State</code>](#State)  
**Returns**: [<code>State</code>](#State) - Resulting instance of the [State](#State).  

| Param | Type | Description |
| --- | --- | --- |
| input | <code>String</code> | Arbitrary input. |

