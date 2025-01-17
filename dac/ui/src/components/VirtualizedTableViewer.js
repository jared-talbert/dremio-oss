/*
 * Copyright (C) 2017-2019 Dremio Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { Component } from 'react';
import Radium from 'radium';
import PropTypes from 'prop-types';
import { AutoSizer, Column, Table } from 'react-virtualized';
import classNames from 'classnames';
import Immutable, { List } from 'immutable';

import Tooltip from '@material-ui/core/Tooltip';

import { humanSorter, getSortValue } from '@app/utils/sort';
import { virtualizedRow } from './VirtualizedTableViewer.less';

const ROW_HEIGHT = 30;
const HEADER_HEIGHT = 30;
const TABLE_BOTTOM_CUSHION = 10;

export const SortDirection = {
  ASC: 'ASC',
  DESC: 'DESC'
};

// todo: make this determined by the render time on the current machine
const DEFERRED_SPEED_THRESHOLD = 5;

@Radium
export default class VirtualizedTableViewer extends Component {
  static propTypes = {
    tableData: PropTypes.oneOfType([
      PropTypes.instanceOf(Immutable.List),
      PropTypes.array
    ]),
    className: PropTypes.string,
    columns: PropTypes.array,
    defaultSortBy: PropTypes.string,
    defaultSortDirection: PropTypes.string,
    style: PropTypes.object,
    resetScrollTop: PropTypes.bool
    // other props passed into react-virtualized Table
  };

  static defaultProps = {
    tableData: Immutable.List()
  };

  state = {
    sortBy: this.props.defaultSortBy,
    sortDirection: this.props.defaultSortDirection
  };

  lastScrollTop = 0;
  lastScrollTime = Date.now();
  lastSpeed = 0;

  sort = ({ sortBy, sortDirection }) => {
    this.setState({
      sortBy,
      sortDirection
    });
  };

  rowClassName(rowData, index) {
    return classNames(((rowData && rowData.rowClassName) || '') + ' ' + (index % 2 ? 'odd' : 'even'), virtualizedRow, 'virtualized-row'); // Adding virtualizedRow for keeping the Row styles stable wrt another class
  }

  handleScroll = ({scrollTop}) => {
    const speed = Math.abs(scrollTop - this.lastScrollTop) / (Date.now() - this.lastScrollTime);

    if (speed < DEFERRED_SPEED_THRESHOLD) {
      DeferredRenderer._flush(); // going slow enough, can afford to flush as we go
    }
    DeferredRenderer._scheduleFlush(); // ALWAYS schedule, for any renders that happen after the onScroll

    this.lastScrollTop = scrollTop;
    this.lastScrollTime = Date.now();
    this.lastSpeed = speed;
  };

  getSortedTableData = () => {
    const { tableData } = this.props;
    const { sortBy, sortDirection } = this.state;
    if (List.isList(tableData)) {
      return sortBy ?
        tableData
          .sortBy(item => getSortValue(item, sortBy, sortDirection), humanSorter)
          .update(table =>
            sortDirection === SortDirection.DESC ? table.reverse() : table
          ) :
        tableData;
    }
    if (sortBy) {
      const sortedData = [...tableData] // keeping the order of the original list intact
        .sort((val1, val2) => {
          return humanSorter(getSortValue(val1, sortBy, sortDirection), getSortValue(val2, sortBy, sortDirection));
        });
      return sortDirection === SortDirection.DESC ? sortedData.reverse() : sortedData;
    }
    return tableData;
  }

  renderHeader = ({ label, dataKey, sortBy, sortDirection },
    /* column */ { style, infoContent, headerStyle, helpContent }) => {
    const isSorted = sortBy === dataKey;
    const headerClassName = classNames(
      'virtualizedTable__headerContent',
      {
        'sort-asc': isSorted && sortDirection === SortDirection.ASC,
        'sort-desc': isSorted && sortDirection === SortDirection.DESC
      }
    );
    const infoContentStyle = {};
    if (isSorted) {
      // sort icon with - 4px to put infoContent closer to sort icon. See .sort-icon() mixin
      infoContentStyle.marginLeft = 20;
    }
    const helperTooltipClass = classNames(
      'dremioIcon-HeaderHelp',
      'iconType',
      'virtualizedTable__helpIcon',
      'margin-left',
      'margin-right--half',
      'text-small'
    );
    return (
      <div style={{ display: 'flex', alignItems: 'center', ...style, ...headerStyle }}>
        <div className={headerClassName}>
          { label === undefined ? dataKey : label}
          {helpContent && <Tooltip title={helpContent} arrow placement='top'>
            <span className={helperTooltipClass}/>
          </Tooltip>}
        </div>
        {infoContent && <span style={infoContentStyle}>
          {infoContent}
        </span>}
      </div>
    );
  };

  renderCell({rowData, isScrolling}, column) {
    // NOTE: factoring in this.lastSpeed here is too slow
    return <DeferredRenderer defer={isScrolling} render={() => rowData.data[column].node()}/>;
  }

  getRow = (sortedTableData, index) => {
    return List.isList(sortedTableData) ? sortedTableData.get(index) : sortedTableData[index];
  }

  render() {
    const { tableData, columns, style, resetScrollTop, ...tableProps } = this.props;
    const { sortBy, sortDirection } = this.state;
    const tableSize = List.isList(tableData) ? tableData.size : tableData.length;
    const sortedTableData = this.getSortedTableData();
    const isEmpty = tableSize === 0;
    const baseStyle = isEmpty ? { height: HEADER_HEIGHT } : { height: '100%' };
    return (
      <div style={[styles.base, baseStyle, style]}>
        <AutoSizer>
          {({width, height}) => {
            const tableHeight = height - TABLE_BOTTOM_CUSHION;
            return (
              <Table
                scrollTop={resetScrollTop ? 0 : undefined} // it's needed for https://dremio.atlassian.net/browse/DX-7140
                onScroll={this.handleScroll}
                headerHeight={HEADER_HEIGHT}
                rowCount={tableSize}
                rowClassName={({index}) => this.rowClassName(this.getRow(sortedTableData, index), index)}
                rowHeight={ROW_HEIGHT}
                rowGetter={({index}) => this.getRow(sortedTableData, index)}
                sortDirection={sortDirection}
                sortBy={sortBy}
                height={tableHeight}
                width={width}
                sort={this.sort}
                {...tableProps}
              >
                {columns.map((item) =>
                  <Column
                    key={item.key}
                    dataKey={item.key}
                    className={item.className || 'column-' + item.key}
                    headerClassName={item.headerClassName}
                    label={item.label}
                    style={item.style}
                    headerRenderer={(options) => this.renderHeader(options, item)}
                    width={item.width || 100}
                    flexGrow={item.flexGrow}
                    disableSort={item.disableSort}
                    cellRenderer={(opts) => this.renderCell(opts, item.key)}
                  />
                )}
              </Table>
            );
          }}
        </AutoSizer>
      </div>
    );
  }
}

const styles = {
  base: {
    flexGrow: 1,
    width: '100%',
    overflow: 'hidden'
  }
};

export class DeferredRenderer extends Component {
  static _deferredRendererSet = new Set();
  static _deferredRendererId = 0;
  static _flush() {
    for (const comp of this._deferredRendererSet) {
      comp.setState({initial: false});
    }
    this._deferredRendererSet = new Set();
  }
  static _scheduleFlush() {
    cancelAnimationFrame(this._deferredRendererId);
    this._deferredRendererId = requestAnimationFrame(() => {
      this._deferredRendererId = requestAnimationFrame(() => this._flush());
    });
  }

  static propTypes = {
    render: PropTypes.func.isRequired,
    defer: PropTypes.bool
  };
  static defaultProps = {
    defer: true
  };
  state = {
    initial: this.props.defer
  };
  componentWillMount() {
    if (this.props.defer) this.constructor._deferredRendererSet.add(this);
  }
  componentWillUnmount() {
    this.constructor._deferredRendererSet.delete(this);
  }

  render() {
    if (this.state.initial) return null;
    return <div>{this.props.render()}</div>;
  }
}
