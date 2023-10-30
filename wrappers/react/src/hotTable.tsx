import React from 'react';
import Handsontable from 'handsontable/base';
import { SettingsMapper } from './settingsMapper';
import { RenderersPortalManager } from './renderersPortalManager';
import { HotColumn } from './hotColumn';
import * as packageJson from '../package.json';
import {
  HotTableProps,
  HotEditorElement,
  HotEditorCache,
  EditorScopeIdentifier
} from './types';
import {
  HOT_DESTROYED_WARNING,
  AUTOSIZE_WARNING,
  GLOBAL_EDITOR_SCOPE,
  createEditorPortal,
  createPortal,
  getChildElementByType,
  getContainerAttributesProps,
  getExtendedEditorElement,
  getOriginalEditorClass,
  warn
} from './helpers';
import PropTypes from 'prop-types';

/**
 * A Handsontable-ReactJS wrapper.
 *
 * To implement, use the `HotTable` tag with properties corresponding to Handsontable options.
 * For example:
 *
 * ```js
 * <HotTable id="hot" data={dataObject} contextMenu={true} colHeaders={true} width={600} height={300} stretchH="all" />
 *
 * // is analogous to
 * let hot = new Handsontable(document.getElementById('hot'), {
 *    data: dataObject,
 *    contextMenu: true,
 *    colHeaders: true,
 *    width: 600
 *    height: 300
 * });
 *
 * ```
 *
 * @class HotTable
 */
class HotTable extends React.Component<HotTableProps, {}> {
  /**
   * The `id` of the main Handsontable DOM element.
   *
   * @type {String}
   */
  id: string = null;
  /**
   * Reference to the Handsontable instance.
   *
   * @private
   * @type {Object}
   */
  __hotInstance: Handsontable | null = null;
  /**
   * Reference to the main Handsontable DOM element.
   *
   * @type {HTMLElement}
   */
  hotElementRef: HTMLElement = null;
  /**
   * Class name added to the component DOM element.
   *
   * @type {String}
   */
  className: string;
  /**
   * Style object passed to the component.
   *
   * @type {React.CSSProperties}
   */
  style: React.CSSProperties;

  /**
   * Array of object containing the column settings.
   *
   * @type {Array}
   */
  columnSettings: Handsontable.ColumnSettings[] = [];

  /**
   * Component used to manage the renderer portals.
   *
   * @type {React.Component}
   */
  renderersPortalManager: RenderersPortalManager = null;

  /**
   * Array containing the portals cashed to be rendered in bulk after Handsontable's render cycle.
   */
  portalCacheArray: React.ReactPortal[] = [];

  /**
   * The rendered cells cache.
   *
   * @private
   * @type {Map}
   */
  private renderedCellCache: Map<string, HTMLTableCellElement> = new Map();

  /**
   * Editor cache.
   *
   * @private
   * @type {Map}
   */
  private editorCache: HotEditorCache = new Map();

  /**
   * Map with column indexes (or a string = 'global') as keys, and booleans as values. Each key represents a component-based editor
   * declared for the used column index, or a global one, if the key is the `global` string.
   *
   * @private
   * @type {Map}
   */
  private componentRendererColumns: Map<number | string, boolean> = new Map();

  /**
   * Package version getter.
   *
   * @returns The version number of the package.
   */
  static get version(): string {
    return (packageJson as any).version;
  }

  /**
   * Getter for the property storing the Handsontable instance.
   */
  get hotInstance(): Handsontable | null {
    if (!this.__hotInstance || (this.__hotInstance && !this.__hotInstance.isDestroyed)) {

      // Will return the Handsontable instance or `null` if it's not yet been created.
      return this.__hotInstance;

    } else {
      console.warn(HOT_DESTROYED_WARNING);

      return null;
    }
  }

  /**
   * Setter for the property storing the Handsontable instance.
   * @param {Handsontable} hotInstance The Handsontable instance.
   */
  set hotInstance(hotInstance) {
    this.__hotInstance = hotInstance;
  }

  /**
   * Prop types to be checked at runtime.
   */
  static propTypes: object = {
    style: PropTypes.object,
    id: PropTypes.string,
    className: PropTypes.string
  };

  /**
   * Get the rendered table cell cache.
   *
   * @returns {Map}
   */
  getRenderedCellCache(): Map<string, HTMLTableCellElement> {
    return this.renderedCellCache;
  }

  /**
   * Get the editor cache and return it.
   *
   * @returns {Map}
   */
  getEditorCache(): HotEditorCache {
    return this.editorCache;
  }

  /**
   * Clear both the editor and the renderer cache.
   */
  clearCache(): void {
    this.getRenderedCellCache().clear();
    this.componentRendererColumns.clear();
  }

  /**
   * Get the `Document` object corresponding to the main component element.
   *
   * @returns The `Document` object used by the component.
   */
  getOwnerDocument() {
    return this.hotElementRef ? this.hotElementRef.ownerDocument : document;
  }

  /**
   * Set the reference to the main Handsontable DOM element.
   *
   * @param {HTMLElement} element The main Handsontable DOM element.
   */
  private setHotElementRef(element: HTMLElement): void {
    this.hotElementRef = element;
  }

  /**
   * Return a renderer wrapper function for the provided renderer component.
   *
   * @param {React.ReactElement} rendererElement React renderer component.
   * @returns {Handsontable.renderers.Base} The Handsontable rendering function.
   */
  getRendererWrapper(rendererElement: React.ReactElement): typeof Handsontable.renderers.BaseRenderer | any {
    const hotTableComponent = this;

    return function (instance, TD, row, col, prop, value, cellProperties) {
      const renderedCellCache = hotTableComponent.getRenderedCellCache();

      if (renderedCellCache.has(`${row}-${col}`)) {
        TD.innerHTML = renderedCellCache.get(`${row}-${col}`).innerHTML;
      }

      if (TD && !TD.getAttribute('ghost-table')) {

        const {portal, portalContainer} = createPortal(rendererElement, {
          TD,
          row,
          col,
          prop,
          value,
          cellProperties,
          isRenderer: true
        }, TD.ownerDocument);

        if (TD.firstChild) {
          TD.firstChild.replaceWith(portalContainer);
        } else {
          TD.appendChild(portalContainer);
        }

        hotTableComponent.portalCacheArray.push(portal);
      }

      renderedCellCache.set(`${row}-${col}`, TD);

      return TD;
    };
  }

  /**
   * Create a fresh class to be used as an editor, based on the provided editor React element.
   *
   * @param {React.ReactElement} editorElement React editor component.
   * @param {string|number} [editorColumnScope] The editor scope (column index or a 'global' string). Defaults to
   * 'global'.
   * @returns {Function} A class to be passed to the Handsontable editor settings.
   */
  getEditorClass(editorElement: HotEditorElement, editorColumnScope: EditorScopeIdentifier = GLOBAL_EDITOR_SCOPE): typeof Handsontable.editors.BaseEditor {
    const editorClass = getOriginalEditorClass(editorElement);
    const cachedComponent = this.getEditorCache().get(editorClass)?.get(editorColumnScope);

    return this.makeEditorClass(cachedComponent);
  }

  /**
   * Create a class to be passed to the Handsontable's settings.
   *
   * @param {React.ReactElement} editorComponent React editor component.
   * @returns {Function} A class to be passed to the Handsontable editor settings.
   */
  makeEditorClass(editorComponent: React.Component): typeof Handsontable.editors.BaseEditor {
    const customEditorClass = class CustomEditor extends Handsontable.editors.BaseEditor implements Handsontable.editors.BaseEditor {
      editorComponent: React.Component;

      constructor(hotInstance) {
        super(hotInstance);

        (editorComponent as any).hotCustomEditorInstance = this;

        this.editorComponent = editorComponent;
      }

      focus() {
      }

      getValue() {
      }

      setValue() {
      }

      open() {
      }

      close() {
      }
    } as any;

    // Fill with the rest of the BaseEditor methods
    Object.getOwnPropertyNames(Handsontable.editors.BaseEditor.prototype).forEach(propName => {
      if (propName === 'constructor') {
        return;
      }

      customEditorClass.prototype[propName] = function (...args) {
        return editorComponent[propName].call(editorComponent, ...args);
      }
    });

    return customEditorClass;
  }

  /**
   * Get the renderer element for the entire HotTable instance.
   *
   * @returns {React.ReactElement} React renderer component element.
   */
  getGlobalRendererElement(): React.ReactElement {
    return getChildElementByType(this.props.children, 'hot-renderer');
  }

  /**
   * Get the editor element for the entire HotTable instance.
   *
   * @param {React.ReactNode} [children] Children of the HotTable instance. Defaults to `this.props.children`.
   * @returns {React.ReactElement} React editor component element.
   */
  getGlobalEditorElement(): HotEditorElement | null {
    return getExtendedEditorElement(this.props.children, this.getEditorCache());
  }

  /**
   * Create a new settings object containing the column settings and global editors and renderers.
   *
   * @returns {Handsontable.GridSettings} New global set of settings for Handsontable.
   */
  createNewGlobalSettings(): Handsontable.GridSettings {
    const newSettings = SettingsMapper.getSettings(this.props);
    const globalRendererNode = this.getGlobalRendererElement();
    const globalEditorNode = this.getGlobalEditorElement();

    newSettings.columns = this.columnSettings.length ? this.columnSettings : newSettings.columns;

    if (globalEditorNode) {
      newSettings.editor = this.getEditorClass(globalEditorNode, GLOBAL_EDITOR_SCOPE);

    } else {
      newSettings.editor = this.props.editor || (this.props.settings ? this.props.settings.editor : void 0);
    }

    if (globalRendererNode) {
      newSettings.renderer = this.getRendererWrapper(globalRendererNode);
      this.componentRendererColumns.set('global', true);

    } else {
      newSettings.renderer = this.props.renderer || (this.props.settings ? this.props.settings.renderer : void 0);
    }

    return newSettings;
  }

  /**
   * Detect if `autoRowSize` or `autoColumnSize` is defined, and if so, throw an incompatibility warning.
   *
   * @param {Handsontable.GridSettings} newGlobalSettings New global settings passed as Handsontable config.
   */
  displayAutoSizeWarning(newGlobalSettings: Handsontable.GridSettings): void {
    if (
      this.hotInstance &&
      (
        this.hotInstance.getPlugin('autoRowSize')?.enabled ||
        this.hotInstance.getPlugin('autoColumnSize')?.enabled
      )
    ) {
      if (this.componentRendererColumns.size > 0) {
        warn(AUTOSIZE_WARNING);
      }
    }
  }

  /**
   * Sets the column settings based on information received from HotColumn.
   *
   * @param {HotTableProps} columnSettings Column settings object.
   * @param {Number} columnIndex Column index.
   */
  setHotColumnSettings(columnSettings: Handsontable.ColumnSettings, columnIndex: number): void {
    this.columnSettings[columnIndex] = columnSettings;
  }

  /**
   * Handsontable's `beforeViewRender` hook callback.
   */
  handsontableBeforeViewRender(): void {
    this.getRenderedCellCache().clear();
  }

  /**
   * Handsontable's `afterViewRender` hook callback.
   */
  handsontableAfterViewRender(): void {
    this.renderersPortalManager.setState({
      portals: [...this.portalCacheArray]
    }, () => {
      this.portalCacheArray = [];
    });
  }

  /**
   * Call the `updateSettings` method for the Handsontable instance.
   *
   * @param {Object} newSettings The settings object.
   */
  private updateHot(newSettings: Handsontable.GridSettings): void {
    if (this.hotInstance) {
      this.hotInstance.updateSettings(newSettings, false);
    }
  }

  /**
   * Set the renderers portal manager ref.
   *
   * @param {React.ReactComponent} pmComponent The PortalManager component.
   */
  private setRenderersPortalManagerRef(pmComponent: RenderersPortalManager): void {
    this.renderersPortalManager = pmComponent;
  }

  /*
  ---------------------------------------
  ------- React lifecycle methods -------
  ---------------------------------------
  */

  /**
   * Initialize Handsontable after the component has mounted.
   */
  componentDidMount(): void {
    const newGlobalSettings = this.createNewGlobalSettings();

    this.hotInstance = new Handsontable.Core(this.hotElementRef, newGlobalSettings);

    this.hotInstance.addHook('beforeViewRender', () => this.handsontableBeforeViewRender());
    this.hotInstance.addHook('afterViewRender', () => this.handsontableAfterViewRender());

    // `init` missing in Handsontable's type definitions.
    (this.hotInstance as any).init();

    this.displayAutoSizeWarning(newGlobalSettings);
  }

  /**
   * Logic performed after the component update.
   */
  componentDidUpdate(): void {
    this.clearCache();

    const newGlobalSettings = this.createNewGlobalSettings();

    this.updateHot(newGlobalSettings);
    this.displayAutoSizeWarning(newGlobalSettings);
  }

  /**
   * Destroy the Handsontable instance when the parent component unmounts.
   */
  componentWillUnmount(): void {
    this.clearCache();

    if (this.hotInstance) {
      this.hotInstance.destroy();
    }
  }

  /**
   * Render the component.
   */
  render(): React.ReactElement {
    const containerProps = getContainerAttributesProps(this.props);
    const isHotColumn = (childNode: any) => childNode.type === HotColumn;
    const children = React.Children.toArray(this.props.children);

    // clone the HotColumn nodes and extend them with the callbacks
    const hotColumnClones = children
      .filter((childNode: any) => isHotColumn(childNode))
      .map((childNode: React.ReactElement, columnIndex: number) => {
        return React.cloneElement(childNode, {
          _componentRendererColumns: this.componentRendererColumns,
          _emitColumnSettings: this.setHotColumnSettings.bind(this),
          _columnIndex: columnIndex,
          _getChildElementByType: getChildElementByType.bind(this),
          _getRendererWrapper: this.getRendererWrapper.bind(this),
          _getEditorClass: this.getEditorClass.bind(this),
          _getOwnerDocument: this.getOwnerDocument.bind(this),
          _getEditorCache: this.getEditorCache.bind(this),
          children: childNode.props.children
        } as object);
      });

    const editorPortal = createEditorPortal(this.getOwnerDocument(), this.getGlobalEditorElement());

    return (
      <React.Fragment>
        <div ref={this.setHotElementRef.bind(this)} {...containerProps}>
          {hotColumnClones}
        </div>
        <RenderersPortalManager ref={this.setRenderersPortalManagerRef.bind(this)} />
        {editorPortal}
      </React.Fragment>
    )
  }
}

export default HotTable;
export { HotTable };
