define(["put-selector/put", "dojo/_base/declare", "dojo/on", "dojo/aspect", "dojo/has", "dojo/has!touch?./TouchScroll", "xstyle/has-class", "dojo/_base/sniff", "xstyle/css!./css/dgrid.css"], 
function(put, declare, listen, aspect, has, TouchScroll, hasClass){
	// Add user agent/feature CSS classes 
	hasClass("mozilla", "opera", "webkit", "ie-6", "ie-6-7", "quirks", "no-quirks");
	
	// Am I webkit? (for RTL)
	var isWebkit = has("webkit");

	// establish an extra stylesheet which addCssRule calls will use,
	// plus an array to track actual indices in stylesheet for removal
	var
		extraSheet = put(document.getElementsByTagName("head")[0], "style"),
		extraRules = [];
	// keep reference to actual StyleSheet object (.styleSheet for IE < 9)
	extraSheet = extraSheet.sheet || extraSheet.styleSheet;
	
	// functions for adding and removing extra style rules.
	// addExtraRule is exposed on the List prototype as addCssRule.
	function addExtraRule(selector, css){
		var index = extraRules.length;
		extraRules[index] = (extraSheet.cssRules || extraSheet.rules).length;
		extraSheet.addRule ?
			extraSheet.addRule(selector, css) :
			extraSheet.insertRule(selector + '{' + css + '}', extraRules[index]);
		return {
			remove: function(){ removeExtraRule(index); }
		}
	}
	function removeExtraRule(index){
		var
			realIndex = extraRules[index],
			i, l = extraRules.length;
		if (realIndex === undefined) { return; } // already removed
		
		// remove rule indicated in internal array at index
		extraSheet.deleteRule ?
			extraSheet.deleteRule(realIndex) :
			extraSheet.removeRule(realIndex); // IE < 9
		
		// Clear internal array item representing rule that was just deleted.
		// NOTE: we do NOT splice, since the point of this array is specifically
		// to negotiate the splicing that occurs in the stylesheet itself!
		extraRules[index] = undefined;
		
		// Then update array items as necessary to downshift remaining rule indices.
		// Can start at index, since array is sparse but strictly increasing.
		for(i = index; i < l; i++){
			if(extraRules[i] > realIndex){ extraRules[i]--; }
		}
	}
	
	var scrollbarWidth;
	var byId = function(id){
		return document.getElementById(id);
	};
	function Row(id, object, element){
		this.id = id;
		this.data = object;
		this.element = element;
	}
	Row.prototype = {
		remove: function(){
			var rowElement = this.element;
			var contentNode = rowElement.parentNode;
			contentNode.removeChild(rowElement);
			var connected = rowElement.connected;
			if(connected){
				// if it has a connected node, remove that as well
				contentNode.removeChild(connected);
			}
		}
	};
	function move(item, steps, targetClass){
		var nextSibling, current, element = current = item.element;
		steps = steps || 1;
		do{
			// move in the correct direction
			if(nextSibling = current[steps < 0 ? 'previousSibling' : 'nextSibling']){
				do{
					current = nextSibling;
					var className = current && current.className;
					if(className && className.indexOf(targetClass) > -1){
						// it's an element with the correct class name, counts as a real move
						element = current;
						steps += steps < 0 ? 1 : -1;
						break;
					}
					// if the next sibling isn't a match, drill down to search
				}while(nextSibling = current[steps < 0 ? 'lastChild' : 'firstChild']);
			}else if((current = current.parentNode) == this.domNode){ // intentional assignment
				// we stepped all the way out of the grid, given up now
				break;
			}
		}while(steps);
		return element;		
	}
	
	// var and function for autogenerating ID when one isn't provided
	var autogen = 0;
	function generateId(){
		return "dgrid_" + autogen++;
	}
	
	return declare(TouchScroll ? [TouchScroll] : [], {
		tabableHeader: false,
		// showHeader: Boolean
		//		Whether to render header (sub)rows.
		showHeader: false,
		
		// isRTL: Boolean
		//		Should the table information display as right-to-left?
		isRTL: false,
		
		postscript: function(params, srcNodeRef){
			// invoke create in postScript to allow descendants to
			// perform logic before create/postCreate happen (a la dijit/_WidgetBase)
			
			if(srcNodeRef){
				// normalize srcNodeRef and store on instance during create process.
				// Doing this in postscript is a bit earlier than dijit would do it,
				// but allows subclasses to access it pre-normalized during create.
				this.srcNodeRef = srcNodeRef =
					srcNodeRef.nodeType ? srcNodeRef : byId(srcNodeRef);
			}
			this.create(params, srcNodeRef);
		},
		getCSSClass: function(shortName){
			return "dgrid-" + shortName;
		},
		listType: "list",
		
		create: function(params, srcNodeRef){
			// mix in params now, but wait until postScript to create
			if(params){
				this.params = params;
				declare.safeMixin(this, params);
			}
			this.domNode = srcNodeRef || put("div");
			
			if(this.isRTL) {
				this.domNode.className += " dgrid-rtl" + (this.isRTL && isWebkit ? "" : " dgrid-rtl-nonwebkit");
			}
			
			this.postMixInProperties();
			// apply id to widget and domNode,
			// from incoming node, widget params, or autogenerated.
			this.buildRendering();
			this.postCreate && this.postCreate();
			// remove srcNodeRef instance property post-create
			delete this.srcNodeRef;
			// to preserve "it just works" behavior, call startup if we're visible
			if(this.domNode.offsetHeight){
				this.startup();
			}
		},
		postMixInProperties: function(){
			this.observers = [];
			this._listeners = [];
			this._rowIdToObject = {};
		},
		buildRendering: function(){
			var domNode = this.domNode;
			this.id = domNode.id = domNode.id || this.id || generateId();
			put(domNode, "[role=grid].ui-widget.dgrid.dgrid-" + this.listType);
			var headerNode = this.headerNode = put(domNode, 
				"div.dgrid-header.dgrid-header-row.ui-widget-header" +
				(this.showHeader ? "" : ".dgrid-header-hidden"));
			if(has("quirks") || has("ie") < 8){
				var spacerNode = put(domNode, "div.dgrid-spacer");
			}
			var bodyNode = this.bodyNode = put(domNode, "div.dgrid-scroller");
			var grid = this;
			this.headerScrollNode = put(domNode, "div.dgrid-header-scroll.dgrid-scrollbar-width.ui-widget-header");
			listen(bodyNode, "scroll", function(event){
				// keep the header aligned with the body
				if(!grid.isRTL || isWebkit) {
					headerNode.scrollLeft = bodyNode.scrollLeft;
				}
				event.stopPropagation(); // we will refire, since browsers are not consistent about propagation here
				listen.emit(domNode, "scroll", {scrollTarget: bodyNode});
			});
			this.configStructure();
			this.renderHeader();
			
			this.contentNode = put(this.bodyNode, "div.dgrid-content.ui-widget-content");
			aspect.after(this, "scrollTo", function(){
				listen.emit(bodyNode, "scroll", {});
			});
			this._listeners.push(listen(window, "resize", function(){
				grid.resize();
			}));
		},
		startup: function(){
			// summary:
			//		Called automatically after postCreate if the component is already
			//		visible; otherwise, should be called manually once placed.
			
			if(this._started){ return; } // prevent double-triggering
			this._started = true;
			this.resize();
			this.refresh();
		},
		
		setShowHeader: function(show){
			// this is in List rather than just in Grid, primarily for two reasons:
			// (1) just in case someone *does* want to show a header in a List
			// (2) helps address IE < 8 header display issue in List
			
			this.showHeader = show;
			
			// add/remove class which has styles for "hiding" header
			put(this.headerNode, (show ? "!" : ".") + "dgrid-header-hidden");
			
			this.renderHeader();
			this.resize(); // to account for (dis)appearance of header
		},
		
		configStructure: function(){
			// does nothing in List, this is more of a hook for the Grid
		},
		resize: function(){
			var
				bodyNode = this.bodyNode,
				headerNode = this.headerNode,
				quirks = has("quirks") || has("ie") < 7;
			this.headerScrollNode.style.height = bodyNode.style.marginTop = headerNode.offsetHeight + "px";
			if(quirks){
				// in quirks mode, the "bottom" CSS property is ignored, so do this to fix it
				// We might want to use a CSS expression or the xstyle package to fix this.
				// We guard against negative values in case of issues with external CSS.
				bodyNode.style.height =
					Math.max((this.domNode.offsetHeight - headerNode.offsetHeight), 0) + "px";
			}
			if(!scrollbarWidth){
				
				// Measure the browser's scrollbar width using a DIV we'll delete right away
				var scrollDiv = put(document.body, "div.dgrid-scrollbar-measure");
				scrollbarWidth = scrollDiv.offsetWidth - scrollDiv.clientWidth;
				put(scrollDiv, "!");
				
				// avoid crazy issues in IE7 only, with certain widgets inside
				if(has("ie") === 7){ scrollbarWidth++; }
				
				// add rules that can be used where scrollbar width/height is needed
				this.addCssRule(".dgrid-scrollbar-width", "width: " + scrollbarWidth + "px");
				this.addCssRule(".dgrid-scrollbar-height", "height: " + scrollbarWidth + "px");
				
				if(scrollbarWidth != 17 && !quirks){
					// for modern browsers, we can perform a one-time operation which adds
					// a rule to account for scrollbar width in all grid headers.
					var isRTLAll = this.isRTL && !isWebkit;
					var selector = (isRTLAll ? (".dgrid-rtl ") : "") + ".dgrid-header";
					this.addCssRule(selector, (isRTLAll ? "left" : "right") + ": " + scrollbarWidth + "px");
				}
			}
			if(quirks){
				// old IE doesn't support left + right + width:auto; set width directly
				headerNode.style.width = bodyNode.clientWidth + "px";
				setTimeout(function(){
					// sync up (after the browser catches up with the new width)
					headerNode.scrollLeft = bodyNode.scrollLeft;
				}, 0);
			}
		},
		addCssRule: addExtraRule,
		on: function(eventType, listener){
			// delegate events to the domNode
			var signal = listen(this.domNode, eventType, listener);
			if(!has("dom-addeventlistener")){
				this._listeners.push(signal);
			}
		},
		destroy: function(){
			var i,
				nodeRefs = ["domNode", "headerNode", "headerScrollNode", "bodyNode",
					"contentNode", "preloadNode", "columns", "subRows", "params"];
			
			// cleanup listeners
			for(i = this._listeners.length; i--;){
				this._listeners[i].remove();
			}
			delete this._listeners;
			
			// destroy DOM
			put("!", this.domNode);
			
			// remove properties that are or may contain node references
			for(i = nodeRefs.length; i--;){
				delete this[nodeRefs[i]];
			}
		},
		refresh: function(){
			// summary:
			//		refreshes the contents of the grid
			this._rowIdToObject = {};
			this._autoId = 0;
			
			// remove the content so it can be recreated
			this.contentNode.innerHTML = "";
			// remove any listeners
			for(var i = 0;i < this.observers.length; i++){
				this.observers[i].cancel();
			}
			this.observers = [];
			if(this.init){
				this.init({
					domNode: this.bodyNode,
					containerNode: this.contentNode
				});
			}
			this.preloadNode = null;
		},
		renderArray: function(results, beforeNode, options){
			// summary:
			//		This renders an array or collection of objects as rows in the grid, before the
			//		given node. This will listen for changes in the collection if an observe method
			//		is available (as it should be if it comes from an Observable data store).
			options = options || {};
			var start = options.start || 0;
			var self = this;
			if(!beforeNode){
				this.lastCollection = results;
			}
			if(results.observe){
				// observe the results for changes
				this.observers.push(results.observe(function(object, from, to){
					// a change in the data took place
					if(from > -1){
						// remove from old slot
						self.row(rows.splice(from, 1)[0]).remove();
					}
					if(to > -1){
						// add to new slot
						var before = rows[to] || beforeNode;
						var row = self.insertRow(object, before.parentNode, before, (options.start + to), options);
						put(row, ".ui-state-highlight");
						setTimeout(function(){
							put(row, "!ui-state-highlight");
						}, 250);
						rows.splice(to, 0, row);
					}
				}, true));
			}
			var rowsFragment = document.createDocumentFragment();
			// now render the results
			if(results.map){
				var rows = results.map(mapEach, console.error);
				if(rows.then){
					return rows.then(whenDone);
				}
			}else{
				var rows = [];
				for(var i = 0, l = results.length; i < l; i++){
					rows[i] = mapEach(results[i]);
				}
			}
			var lastRow;
			function mapEach(object){
				return lastRow = self.insertRow(object, rowsFragment, null, start++, options);
			}
			function whenDone(resolvedRows){
				(beforeNode && beforeNode.parentNode || self.contentNode).insertBefore(rowsFragment, beforeNode || null);
				if(!beforeNode){
					put(lastRow, ".dgrid-last-row");
				}
				return rows = resolvedRows;
			}
			return whenDone(rows);
		},
		_autoId: 0,
		renderHeader: function(){
			// no-op in a place list 
		},
		insertRow: function(object, parent, beforeNode, i, options){
			// summary:
			//		Renders a single row in the grid
			var row = this.renderRow(object, options);
			row.className = (row.className || "") + " ui-state-default dgrid-row " + (i% 2 == 1 ? "dgrid-row-odd" : "dgrid-row-even");
			// get the row id for easy retrieval
			this._rowIdToObject[row.id = this.id + "-row-" + ((this.store && this.store.getIdentity) ? this.store.getIdentity(object) : this._autoId++)] = object;
			parent.insertBefore(row, beforeNode);
			return row;
		},
		renderRow: function(value, options){
			return put("div", "" + value);
		},
		row: function(target){
			// summary:
			//		Get the row object by id, object, node, or event
			if(target.target && target.target.nodeType){
				// event
				target = target.target;
			}
			if(target.nodeType){
				var object;
				do{
					var rowId = target.id;
					if(object = this._rowIdToObject[rowId]){
						return new Row(rowId.substring(this.id.length + 5), object, target); 
					}
					target = target.parentNode;
				}while(target && target != this.domNode);
				return;
			}
			if(typeof target == "object"){
				// assume target represents a store item
				var id = this.store.getIdentity(target);
			}else{
				// assume target is a row ID
				var id = target;
				target = this._rowIdToObject[this.id + "-row-" + id];
			}
			return new Row(id, target, byId(this.id + "-row-" + id));
		},
		cell: function(target){
			// this doesn't do much in a plain list
			return {
				row: this.row(target)
			};
		},
		_move: move,
		up: function(row, steps){
			return this.row(move(row, -(steps || 1), "dgrid-row"));
		},
		down: function(row, steps){
			return this.row(move(row, steps || 1, "dgrid-row"));
		},
		sort: function(property, descending){
			// summary:
			//		Sort the content
			// property: String|Array
			//		String specifying field to sort by, or actual array of objects
			//		with attribute and descending properties
			// descending: boolean
			//		In the case where property is a string, this argument
			//		specifies whether to sort ascending (false) or descending (true)
			
			this.sortOrder = typeof property != "string" ? property :
				[{attribute: property, descending: descending}];
			this.refresh();
			
			if(this.lastCollection){
				// if an array was passed in, flatten to just first sort attribute
				// for default array sort logic
				if(typeof property != "string"){
					descending = property[0].descending;
					property = property[0].attribute;
				}
				
				this.lastCollection.sort(function(a,b){
					var aVal = a[property], bVal = b[property];
					// fall back undefined values to "" for more consistent behavior
					if (aVal === undefined) aVal = "";
					if (bVal === undefined) bVal = "";
					return aVal == bVal ? 0 : (aVal > bVal == !descending ? 1 : -1);
				});
				this.renderArray(this.lastCollection);
			}
		}
	});
});